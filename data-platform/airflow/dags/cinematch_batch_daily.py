"""DAG quotidien de CineMatch : sources → Bronze → Silver → Postgres → Gold (dbt).

Chaque tâche lance un module Python dans son propre processus (python -m ...), comme à la main :
Spark démarre et s'arrête avec la tâche, ce qui libère sa mémoire (ADR 0002).
La date traitée est la date logique du run ({{ ds }}) : relancer un run retraite la même partition (idempotence).
"""

from datetime import datetime, timedelta

from airflow.providers.standard.operators.bash import BashOperator
from airflow.sdk import DAG

default_args = {
    "owner": "cinematch",
    "retries": 2,                                # les API et le réseau peuvent échouer ponctuellement
    "retry_delay": timedelta(minutes=5),
    "execution_timeout": timedelta(hours=1),     # une tâche bloquée ne reste pas en cours indéfiniment
}

with DAG(
    dag_id="cinematch_batch_daily",
    description="Ingestion TMDB, IMDb, MovieLens puis Silver (Spark), publication Postgres et Gold (dbt)",
    schedule="0 6 * * *",                        # chaque jour à 6 h (UTC) : le classement tendance est pris à heure fixe
    start_date=datetime(2026, 10, 1),
    catchup=False,                               # le classement tendance TMDB d'un jour passé n'est plus disponible
    max_active_runs=1,                           # deux runs en parallèle écriraient dans les mêmes tables Delta
    default_args=default_args,
    tags=["cinematch", "batch"],
) as dag:
    # --- 1. Ingestion → Bronze (appels HTTP, peu de mémoire : les trois sources en parallèle) ---
    ingest_tmdb = BashOperator(
        task_id="ingest_tmdb",
        bash_command="python -m cinematch.ingestion.tmdb --date {{ ds }} --pages 5",
    )
    ingest_imdb = BashOperator(
        task_id="ingest_imdb",
        bash_command="python -m cinematch.ingestion.imdb --date {{ ds }}",
    )
    # MovieLens ne change pas : le téléchargement est ignoré s'il est déjà dans Bronze
    ingest_movielens = BashOperator(
        task_id="ingest_movielens",
        bash_command="python -m cinematch.ingestion.movielens",
    )

    # --- 2. Bronze → Silver (Spark : une tâche à la fois, pour ne pas saturer la mémoire) ---
    silver_tmdb = BashOperator(
        task_id="silver_tmdb",
        bash_command="python -m cinematch.transform.silver_tmdb --date {{ ds }}",
    )
    silver_movielens = BashOperator(
        task_id="silver_movielens",
        bash_command="python -m cinematch.transform.silver_movielens",
    )
    # En dernier : IMDb est filtré sur le catalogue construit par silver_tmdb et silver_movielens
    silver_imdb = BashOperator(
        task_id="silver_imdb",
        bash_command="python -m cinematch.transform.silver_imdb --date {{ ds }}",
    )

    # --- 3. Silver → Postgres (copie des tables Delta dans le schéma silver) ---
    publish_silver = BashOperator(
        task_id="publish_silver",
        bash_command="python -m cinematch.transform.publish_silver",
    )

    # --- 4. Gold avec dbt (DBT_PROJECT_DIR et DBT_PROFILES_DIR viennent de docker-compose.yml) ---
    # Fraîcheur des sources : avertit si les données ont plus de 2 jours (voir _sources.yml)
    dbt_source_freshness = BashOperator(
        task_id="dbt_source_freshness",
        bash_command="dbt source freshness",
    )
    # Construit les modèles et lance les tests, dans l'ordre du lignage
    dbt_build = BashOperator(
        task_id="dbt_build",
        bash_command="dbt build",
    )

    # --- Ordre d'exécution ---
    [ingest_tmdb, ingest_imdb, ingest_movielens] >> silver_tmdb
    silver_tmdb >> silver_movielens >> silver_imdb >> publish_silver
    publish_silver >> dbt_source_freshness >> dbt_build
