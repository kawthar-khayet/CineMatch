# Feuille de route — 4 semaines

## Semaine 1 — Socle et batch ✅
- [x] `docker compose up` fonctionne (Postgres, RustFS, Airflow)
- [x] Ingestion MovieLens → Bronze
- [x] Ingestion TMDB → Bronze (classements + fiches avec crédits)
- [x] Ingestion IMDb → Bronze (notes + type de contenu)
- [x] Spark Bronze → Silver (Delta) + publication Postgres
- [x] Premier passage complet du DAG `cinematch_batch_daily` (2026-10-08, 4 min, 9 tâches)

## Semaine 2 — Gold et qualité (rendre le dépôt présentable)
- [x] `dbt build` vert : staging, étoile, indice « Hype ou Pépite » (74 modèles et tests)
- [ ] Snapshot SCD2 (`snap_tmdb_movies.yml`) branché dans `dim_movie` et dans le DAG
- [x] Tests dbt + fraîcheur des sources (dont le test métier `assert_gems_are_movies`)
- [ ] README avec capture du DAG Airflow et du lignage dbt
- [ ] **Commencer à postuler**, avec le lien GitHub dans le CV

## Semaine 3 — Temps réel et tendances
- [ ] Kafka + producteur (`--profile streaming`)
- [ ] `events_to_bronze` planifié toutes les 15 min
- [ ] Silver des événements (dédoublonnage par `event_id`)
- [ ] Ingestion Wikipédia (correspondance tmdb_id → article via Wikidata P4947, puis vues quotidiennes)
- [ ] `mart_movie_momentum` enrichi : popularité TMDB + vues Wikipédia + événements

## Semaine 4 — Exposition et finitions
- [ ] Tableaux de bord Metabase : tendances, films émergents, acteurs, qualité des données
- [ ] Recommandation explicable (`src/cinematch/recommendation/`) + évaluation hors ligne
- [ ] API FastAPI (bonus, si le temps le permet)
- [ ] Monitoring : alertes d'échec Airflow, table de métriques des exécutions
- [ ] CI verte, ADR à jour, vidéo de démo de 2 minutes

## Bonus — Portage Databricks (1 à 2 jours, fin de semaine 4 ou juste après)
- [ ] Compte Databricks Free Edition (+ vérification LinkedIn pour l'accès Internet sortant)
- [ ] Catalogue `cinematch` + schémas `bronze` / `silver` / `gold` + volume pour les fichiers bruts
- [ ] Téléversement d'un instantané de Bronze dans le volume
- [ ] Notebook Bronze → Silver qui réutilise les fonctions de `src/cinematch/transform/`
- [ ] Gold (sous-ensemble) + contrôles qualité en SQL
- [ ] Job Databricks (Workflow) déployé par Asset Bundle
- [ ] Captures d'écran dans `docs/images/` + section dans le README

## Compétences du sujet → où elles sont démontrées
| Compétence | Emplacement |
|---|---|
| Ingestion 2 à 3 sources | `src/cinematch/ingestion/` (TMDB, IMDb, MovieLens ; Wikipédia et Kafka à venir) |
| Batch | DAG `cinematch_batch_daily` |
| Streaming | `streaming/producer.py`, `streaming/events_to_bronze.py` |
| Data lake / lakehouse | RustFS (compatible S3) + Delta, couches bronze / silver |
| Modélisation dimensionnelle | `dbt/models/marts/` |
| ETL / ELT | Spark (ETL vers Silver) + dbt (ELT vers Gold) |
| Orchestration | `airflow/dags/cinematch_batch_daily.py` (Airflow 3.3) |
| Qualité des données | tests dbt (dont test métier), fraîcheur, seuil d'échec à l'ingestion |
| Incrémental | MERGE Delta, modèles dbt `incremental`, checkpoints streaming |
| Changements de schéma | `schema.autoMerge`, `on_schema_change` |
| Lignage | `dbt docs generate` |
| Monitoring / logs | logs et reprises Airflow, fraîcheur dbt, (semaine 4) alertes |
| Docker | `docker-compose.yml`, `docker/airflow/Dockerfile` |
| Tests / CI-CD | `tests/`, `.github/workflows/ci.yml` |
| Tableaux de bord / SQL | `mart_hype_or_gem` ; Metabase et `mart_movie_momentum` à venir |
| Documentation | `README.md`, `docs/` |
