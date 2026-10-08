# Récapitulatif — Étape 4 : orchestration avec Airflow

## 1. En une phrase

> « J'ai ajouté Airflow à la plateforme : un DAG quotidien enchaîne l'ingestion des trois sources, les
> transformations Spark, la publication dans Postgres et dbt, avec reprises automatiques en cas d'échec.
> Le pipeline complet tourne sans intervention en 4 minutes, avec les mêmes résultats qu'à la main. »

## 2. Ce qui a été construit

```
                       ┌──────────────── Docker Compose ────────────────┐
                       │                                                │
 http://localhost:8080 │  airflow-apiserver      interface web + API    │
                       │  airflow-scheduler      planifie ET exécute    │──► RustFS (S3)
                       │                         les tâches (Spark ici) │──► Postgres (base cinematch)
                       │  airflow-dag-processor  lit le dossier dags/   │
                       │  airflow-init           crée la base, le       │──► Postgres (base airflow)
                       │                         compte admin, s'arrête │
                       └────────────────────────────────────────────────┘
```

| Étape | Contenu | Fichiers |
|---|---|---|
| 1 | Une image Airflow capable de lancer Spark et dbt | `data-platform/docker/airflow/Dockerfile`, `pyproject.toml` |
| 2 | Les services Airflow et leur configuration | `docker-compose.yml`, `data-platform/docker/postgres/init.sql`, `.env.example` |
| 3 | Le DAG quotidien | `data-platform/airflow/dags/cinematch_batch_daily.py` |
| 4 | Des logs Spark lisibles dans Airflow | `spark_session.py` (`spark.ui.showConsoleProgress`) |

**Pourquoi Airflow ?** (ADR 0004) C'est le standard du marché et la compétence la plus demandée dans les offres.
Dagster a été étudié : approche par *assets* plus moderne, mais beaucoup moins présent dans les offres de stage.

## 3. Vocabulaire Airflow

| Terme | Ce que c'est | Chez CineMatch |
|---|---|---|
| **DAG** (*Directed Acyclic Graph*) | Un graphe de tâches orienté et sans boucle : il décrit **quoi** lancer et **dans quel ordre** | `cinematch_batch_daily` |
| **Tâche** (*task*) | Une étape du DAG | `silver_tmdb` |
| **Opérateur** | Le type de tâche : ce qu'elle sait faire | `BashOperator` : lance une commande |
| **Run** (*DAG run*) | Une exécution du DAG, pour une date donnée | `scheduled__2026-10-08T06:00:00+00:00` |
| **Task instance** | Une exécution d'une tâche dans un run (avec ses tentatives et ses logs) | `silver_imdb` du run du 8 octobre |
| **Date logique** (`{{ ds }}`) | La date que le run traite, au format `AAAA-MM-JJ` | Passée à `--date` |
| **Executor** | Où et comment les tâches s'exécutent | `LocalExecutor` : dans le conteneur du scheduler |

## 4. L'image Airflow (`Dockerfile`)

Base : l'image officielle `apache/airflow:3.3.2-python3.11` (même version de Python que l'image Spark).

| Choix | Pourquoi |
|---|---|
| Java 17 **copié** depuis `eclipse-temurin:17-jre` (`COPY --from=`) | Spark tourne sur la JVM. Copier Java fonctionne quelle que soit la version de Debian de l'image Airflow, contrairement à `apt-get install openjdk-17` |
| `JAVA_HOME` + ajout au `PATH` | Spark trouve Java par `JAVA_HOME` ; le `PATH` rend la commande `java` disponible pour le débogage |
| `pip install "apache-airflow==${AIRFLOW_VERSION}" -r requirements` | En redemandant la version d'Airflow déjà installée, on empêche pip de la modifier en installant nos bibliothèques |
| **dbt dans un environnement virtuel séparé** (`/home/airflow/dbt-venv`) | Les dépendances de dbt entrent en conflit avec celles d'Airflow : chacun garde ses versions |
| dbt ajouté à la **fin** du `PATH` | La commande `dbt` est trouvée partout, sans remplacer le Python d'Airflow |
| Code **non copié** dans l'image, `PYTHONPATH=/opt/airflow/src` | Le code est partagé par un volume : une modification est prise en compte sans reconstruire l'image |
| Une seule liste `requirements.txt` pour tout le projet | Les mêmes versions sur le PC, dans l'image Spark et dans l'image Airflow |

`pyproject.toml` décrit aussi le projet comme paquet Python (`pip install -e .`) : sur le PC, `cinematch` est importable
depuis n'importe quel dossier.

## 5. Les services Airflow (`docker-compose.yml`)

### L'architecture d'Airflow 3

| Service | Rôle |
|---|---|
| `airflow-init` | S'exécute une fois : crée les tables de la base `airflow` (`_AIRFLOW_DB_MIGRATE`) et le compte administrateur, puis s'arrête |
| `airflow-apiserver` | L'interface web et l'API REST (remplace le *webserver* d'Airflow 2), port 8080 |
| `airflow-scheduler` | Décide quand lancer chaque tâche **et**, avec `LocalExecutor`, les exécute : c'est ici que Spark tourne (ADR 0002) |
| `airflow-dag-processor` | Lit les fichiers du dossier `dags/` et les enregistre dans la base (service séparé depuis Airflow 3) |

`airflow-init` démarre avant les autres : `depends_on` avec `condition: service_completed_successfully`.

### La configuration commune (ancres YAML)

Les quatre services partagent la même image, les mêmes volumes et les mêmes variables. Pour ne pas les répéter,
`docker-compose.yml` les définit une fois dans `x-airflow-common` (une **ancre** `&airflow-common`), puis chaque service
la reprend avec `<<: *airflow-common`.

| Variable | Valeur | Pourquoi |
|---|---|---|
| `AIRFLOW__CORE__EXECUTOR` | `LocalExecutor` | Pas besoin de Redis ni de workers séparés à cette échelle |
| `AIRFLOW__CORE__PARALLELISM` | `4` | Par défaut (32), LocalExecutor prépare un processus par tâche possible : trop pour un portable |
| `AIRFLOW__DATABASE__SQL_ALCHEMY_CONN` | Base `airflow` du Postgres existant | Un seul Postgres : base `cinematch` pour les données, base `airflow` pour l'historique des runs |
| `AIRFLOW__CORE__AUTH_MANAGER` | `FabAuthManager` | Gestion des comptes qui permet de créer l'administrateur au démarrage, depuis `.env` |
| `AIRFLOW__API_AUTH__JWT_SECRET` | `${AIRFLOW_JWT_SECRET}` | Clé qui signe les échanges entre les composants (secret, dans `.env`) |
| `AIRFLOW__CORE__EXECUTION_API_SERVER_URL` | `http://airflow-apiserver:8080/execution/` | Airflow 3 : les tâches envoient leur état à l'API, plus directement à la base |
| `AIRFLOW__SCHEDULER__ENABLE_HEALTH_CHECK` | `true` | Active la page de santé du scheduler (port 8974), utilisée par son `healthcheck` |
| `AIRFLOW__CORE__DAGS_ARE_PAUSED_AT_CREATION` | `true` | Un nouveau DAG ne démarre pas tout seul : on l'active volontairement |
| `S3_ENDPOINT`, `POSTGRES_HOST`, `POSTGRES_PORT` | Noms des services Docker | Même règle que pour `spark-jobs` : depuis un conteneur, on joint un service par son nom, pas `localhost` |
| `DBT_PROJECT_DIR`, `DBT_PROFILES_DIR` | `/opt/airflow/dbt` | dbt lit ces variables : `dbt build` fonctionne sans option |

`load_dotenv()` (dans `config.py`) **ne remplace pas** une variable déjà définie : les valeurs Docker restent prioritaires
sur celles de `.env`.

### Les volumes

| Volume | Rôle |
|---|---|
| `./data-platform/airflow/dags` → `/opt/airflow/dags` | Les DAGs, modifiables sans redémarrer |
| `./data-platform/src` → `/opt/airflow/src` | Le code du pipeline (même code que sur le PC) |
| `./data-platform/dbt` → `/opt/airflow/dbt` | Le projet dbt |
| `airflow-logs` | Les logs de chaque tâche |
| `airflow-ivy-cache` | Les bibliothèques Java de Spark (Delta, S3A, pilote Postgres), téléchargées une seule fois |

### La base `airflow`

`init.sql` crée la base `airflow`, mais il n'est exécuté **qu'à la création du volume Postgres**. Le volume existant
déjà, la base a été créée à la main (voir section 9).

## 6. Le DAG `cinematch_batch_daily`

```
ingest_tmdb ──────┐
ingest_imdb ──────┼─► silver_tmdb ─► silver_movielens ─► silver_imdb ─► publish_silver ─► dbt_source_freshness ─► dbt_build
ingest_movielens ─┘
```

### Les choix

| Choix | Pourquoi |
|---|---|
| Une tâche = une commande `python -m ...` (`BashOperator`) | Les mêmes commandes qu'à la main. Chaque tâche Spark démarre et arrête sa JVM : la mémoire est libérée (ADR 0002) |
| Ingestions **en parallèle** | Ce sont des appels HTTP : peu de mémoire, beaucoup d'attente |
| Tâches Spark **l'une après l'autre** | Ne pas saturer la mémoire du portable (2 Go de mémoire pour chaque processus Spark) |
| `silver_imdb` en dernier | IMDb est filtré sur le catalogue construit par `silver_tmdb` et `silver_movielens` |
| `--date {{ ds }}` | Relancer un run retraite **la même partition** : idempotence |
| `schedule="0 6 * * *"` | Tous les jours à 6 h UTC : le classement tendance, qui change dans la journée, est pris à heure fixe |
| `catchup=False` | Le classement tendance TMDB d'un jour passé n'est plus disponible : rattraper les jours manqués n'aurait pas de sens |
| `max_active_runs=1` | Deux runs en même temps écriraient dans les mêmes tables Delta |
| `retries=2`, `retry_delay=5 min` | Les API et le réseau peuvent échouer ponctuellement |
| `execution_timeout=1 h` | Une tâche bloquée ne reste pas « en cours » indéfiniment |
| `dbt source freshness` avant `dbt build` | Signaler dans les logs des données de plus de 2 jours |

### Planification : ce qui s'est passé à l'activation

En activant le DAG à 9 h 38, Airflow a lancé **immédiatement** le run de 6 h du jour. Avec `catchup=False`, il ne
rattrape pas tous les jours depuis `start_date`, mais il exécute quand même **le dernier run prévu et manqué**.
Il n'a donc pas fallu cliquer sur « Déclencher ».

## 7. Résultats du premier run (2026-10-08)

| Tâche | Durée |
|---|---|
| `ingest_movielens` | 4 s (déjà dans Bronze : téléchargement ignoré) |
| `ingest_imdb` | 28 s |
| `ingest_tmdb` | 35 s |
| `silver_tmdb` | 1 min 20 (premier lancement : téléchargement des bibliothèques Java) |
| `silver_movielens` | 26 s |
| `silver_imdb` | 52 s (9 797 notes gardées sur 1 718 390) |
| `publish_silver` | 27 s |
| `dbt_source_freshness` | 9 s (aucun avertissement) |
| `dbt_build` | 9 s (`PASS=74 WARN=0 ERROR=0`) |
| **Total** | **4 min 03** |

`mart_hype_or_gem` : 138 pépites cachées, 36 vraies tendances, 21 buzz trompeurs, 20 tendances moyennes,
17 tendances non notées. **Mêmes résultats qu'à la main** : l'orchestration ne change rien aux données.

Mémoire : environ 2,4 Go pour le conteneur du scheduler pendant `silver_imdb`, sur 7,5 Go disponibles pour Docker.

## 8. Les problèmes rencontrés

| Problème | Cause | Résolution |
|---|---|---|
| `psql` : « *syntax error at end of input* » sur `CREATE` | PowerShell retire les guillemets doubles imbriqués avant de passer la commande à Docker | Envoyer la requête par l'entrée standard : `"CREATE DATABASE airflow;" \| docker compose exec -T postgres ...` |
| Le scheduler reste « *health: starting* » | La page de santé du scheduler est désactivée par défaut | `AIRFLOW__SCHEDULER__ENABLE_HEALTH_CHECK=true` |
| De nombreux processus au démarrage du scheduler | LocalExecutor prépare un processus par tâche possible (`parallelism`) | `AIRFLOW__CORE__PARALLELISM=4` |
| `java: command not found` dans le conteneur | Java copié dans `/opt/java/openjdk`, mais absent du `PATH` (Spark, lui, utilisait `JAVA_HOME`) | `ENV PATH="${JAVA_HOME}/bin:${PATH}"` |
| Les messages du code invisibles dans les logs Airflow | La barre de progression de Spark se redessine avec `\r` : dans Airflow, la suite de la ligne est repoussée hors de l'écran | `spark.ui.showConsoleProgress=false` |
| Avertissement Delta : « *Merge source has 0 rows in initial scan but 9797 rows in second scan* » | Un MERGE lit la source deux fois et compare les comptages ; Spark a optimisé la jointure avant le premier comptage | Aucune action : la source est déterministe (fichier Bronze + jointure) et la table contient bien les 9 797 lignes |

## 9. Commandes utiles

```powershell
# Démarrer toute la plateforme (RustFS, Postgres, Airflow)
docker compose up -d

# État des services : airflow-init doit être « Exited (0) », les autres « healthy »
docker compose ps -a

# Créer la base airflow, une seule fois, si le volume Postgres existait déjà
"CREATE DATABASE airflow;" | docker compose exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'

# Reconstruire l'image après un changement du Dockerfile ou de requirements.txt
docker compose build airflow-init

# Vérifier que les DAGs se chargent sans erreur
docker compose exec airflow-scheduler airflow dags list-import-errors

# État des tâches d'un run
docker compose exec airflow-scheduler airflow tasks states-for-dag-run cinematch_batch_daily <run_id>

# Logs d'un service Airflow (démarrage, erreurs de configuration)
docker compose logs airflow-scheduler
```

**Lire les logs d'une tâche dans l'interface** : page du DAG → case de la tâche dans la grille (ou onglet
*Task Instances*) → onglet **Journaux**. Le *Journal d'audit* ne montre que les changements d'état, pas la sortie du script.

Sur disque, un fichier par tentative :
`/opt/airflow/logs/dag_id=<dag>/run_id=<run>/task_id=<tâche>/attempt=<n>.log` (volume `airflow-logs`).

## 10. Questions probables en entretien

| Question | Réponse courte |
|---|---|
| Qu'est-ce qu'un DAG ? | Un graphe de tâches orienté et sans boucle : il décrit les étapes du pipeline et leurs dépendances. |
| Pourquoi `LocalExecutor` et pas `CeleryExecutor` ? | Une seule machine et un volume modeste : Celery ajouterait Redis et des workers sans bénéfice. Le DAG ne changerait pas en passant à Celery ou Kubernetes. |
| Pourquoi `BashOperator` plutôt que `SparkSubmitOperator` ? | Chaque tâche lance le même module qu'à la main, dans son propre processus. Pas de cluster Spark ni d'accès au socket Docker (fragile sous Windows), voir ADR 0002. |
| Comment le pipeline gère-t-il une relance ? | Chaque tâche reçoit la date logique (`{{ ds }}`) et réécrit sa partition ou fait un MERGE : relancer un run ne crée pas de doublons. |
| Pourquoi `catchup=False` ? | Le classement tendance d'un jour passé n'est plus disponible chez TMDB : rattraper les jours manqués produirait de fausses données. |
| Que se passe-t-il si l'API TMDB tombe ? | La tâche est retentée 2 fois à 5 minutes d'intervalle ; si elle échoue encore, les tâches suivantes ne démarrent pas (`upstream_failed`) et Gold garde les données de la veille. |
| Où est stocké l'historique des runs ? | Dans la base `airflow` du même Postgres, séparée de la base `cinematch` des données. |
| Comment dbt et Airflow cohabitent-ils dans la même image ? | dbt est installé dans un environnement virtuel séparé : leurs dépendances sont incompatibles. |

## 11. Pour un entretien

> « J'ai orchestré le pipeline avec Airflow 3, en Docker Compose. Un DAG quotidien lance les ingestions en parallèle,
> puis les transformations Spark une par une pour tenir dans la mémoire d'un portable, la publication dans Postgres
> et dbt. Chaque tâche reçoit la date logique du run, ce qui rend les relances idempotentes, et les échecs réseau
> sont retentés automatiquement. Le pipeline complet tourne en 4 minutes et donne exactement les mêmes résultats
> qu'à la main. »

## 12. La suite

- **Rendre le dépôt présentable** : README avec une capture du DAG et du lignage dbt, CI verte.
- **Monitoring** : alerte en cas d'échec d'un run, table de métriques des exécutions.
- **SCD2** sur `dim_movie` (snapshot dbt `snap_tmdb_movies.yml`), à ajouter au DAG.
- **Streaming** : Kafka et le DAG `cinematch_events_stream` (toutes les 15 minutes).
- **Recommandation** : le DAG `cinematch_recommendations`.
