# CineMatch — Vue d'ensemble du pipeline de données

> Document de synthèse : à lire en premier. Le détail de chaque étape est dans les récapitulatifs 01 à 06.

## 1. Les pitchs

### En 15 secondes

> « CineMatch est une plateforme de données de bout en bout : elle collecte chaque jour des données de films
> (TMDB, IMDb, MovieLens), les transforme dans une architecture médaillon (Spark, Delta Lake, dbt), orchestrée
> par Airflow, et produit un modèle en étoile et un indicateur qui dit si le buzz d'un film est mérité. »

### En 2 minutes

> « Le problème : il y a énormément de films, et les plateformes recommandent surtout ce qui est déjà populaire,
> sans dire si le buzz est mérité. J'ai construit la plateforme de données qui permet d'y répondre.
>
> Trois sources sont ingérées : l'API TMDB pour le catalogue et les tendances du jour, les fichiers officiels d'IMDb
> pour les notes et le type de contenu, et MovieLens pour les goûts de vrais utilisateurs. Les données brutes sont
> stockées dans un data lake compatible S3, partitionnées par date, de façon idempotente.
>
> Spark aplatit le JSON imbriqué, nettoie, harmonise les identifiants entre sources et écrit en Delta Lake par MERGE.
> Les tables sont publiées dans Postgres, où dbt construit un modèle en étoile — dimensions, ponts, faits dont deux
> incrémentaux — testé automatiquement, avec le lignage généré. Airflow enchaîne toute la chaîne chaque jour
> à heure fixe, en 4 minutes, avec reprises automatiques en cas d'échec.
>
> Au-dessus, l'indice "Hype ou Pépite" croise le buzz et la qualité. Sa première version passait tous les tests,
> mais l'analyse des résultats a montré que mes "pépites" étaient surtout des épisodes de séries : j'ai ingéré
> le type de contenu, resserré les règles et ajouté un test métier. Les pépites sont passées de 1 019 à 138,
> toutes des films. »

## 2. L'architecture

```
 SOURCES                  BRONZE                 SILVER                         GOLD
 ───────                  ──────                 ──────                         ────
 API TMDB        ─┐                          ┌─► tmdb_movies
 (tendances,      │                          ├─► tmdb_movie_genres         ┌─► dim_movie, dim_person,
  fiches)         │   RustFS (S3)            ├─► tmdb_movie_people         │   dim_genre, dim_date
                  ├─► bronze/  ──── Spark ───┼─► tmdb_trending_daily       ├─► bridge_movie_person,
 IMDb (fichiers   │   brut, partitionné      ├─► imdb_ratings_daily  ─JDBC─┤   bridge_movie_genre
  .tsv.gz)        │   par date               ├─► imdb_titles     Postgres  ├─► fact_ratings,
                  │                          ├─► movielens_ratings  + dbt  │   fact_trending_daily,
 MovieLens (ZIP) ─┘                          ├─► movielens_links           │   fact_imdb_ratings_daily
                                             └─► movielens_movies          └─► mart_hype_or_gem
   Python (requests, boto3)      Spark + Delta Lake (MERGE)        dbt (staging = vues, marts = tables)
   ── INGESTION ──               ──────── ETL ────────             ──────── ELT ────────

   └──────────────────── Airflow : DAG cinematch_batch_daily, chaque jour à 6 h UTC ────────────────────┘
```

| Couche | Où | Format | Produite par |
|---|---|---|---|
| 🥉 Bronze | RustFS, `lakehouse/bronze/` | JSON Lines, CSV, TSV compressé (tel quel) | Ingestion Python |
| 🥈 Silver | RustFS, `lakehouse/silver/` (+ copie dans Postgres, schéma `silver`) | Delta Lake | Spark |
| 🥇 Gold | Postgres, schémas `staging` (vues) et `marts` (tables) | Tables SQL | dbt |

Gold vit dans Postgres et non dans le lake (ADR 0001) : dbt, la BI, l'API et le frontend s'y connectent simplement.

## 3. La stack technique et ses justifications

| Rôle | Outil | Pourquoi |
|---|---|---|
| Ingestion | Python 3.11, `requests`, `boto3` | API REST et téléchargement de fichiers ; boto3 = client S3 standard |
| Stockage objet (data lake) | **RustFS 1.0.1** (compatible S3) | Protocole S3 standard, code portable vers AWS ; remplace MinIO (image retirée de Docker Hub) |
| Format de tables | **Delta Lake 3.2** | Transactions, MERGE, contrôle du schéma, historique (registre `_delta_log`) |
| Traitement | **Spark 3.5** (PySpark), dans Docker | Passe à l'échelle (1,7 million de lignes IMDb par jour), Delta natif, portable sur Databricks |
| Entrepôt | **PostgreSQL 16** | Simple pour dbt, la BI et l'API |
| Modélisation | **dbt 1.12** (+ `dbt_utils`) | SQL versionné, ordre, tests, documentation, lignage ; 1.12 = support actif, écrit pour être compatible v2 |
| Conteneurs | **Docker Compose** | Toute la plateforme se lance avec une commande, de façon reproductible |
| Orchestration | **Airflow 3.3** (`LocalExecutor`) | Le standard du marché (ADR 0004) ; une seule machine, donc pas de Redis ni de workers séparés |

Image Spark : `python:3.11-slim-bookworm` + Java 17 (Spark 3.5 → Java 17 → Debian 12).
Image Airflow : `apache/airflow:3.3.2-python3.11` + Java 17 (pour Spark) + dbt dans un environnement virtuel séparé.

## 4. Le parcours d'une donnée, de la source à Gold

| Étape | Ce qui se passe | Exemple : *Spider-Man: Brand New Day* |
|---|---|---|
| Ingestion | La fiche complète est demandée à l'API TMDB (crédits inclus) | Une ligne JSON de ~45 Ko dans `bronze/tmdb/movie_details/ingest_date=2026-10-05/` |
| Silver | Spark aplatit le JSON | 1 ligne dans `tmdb_movies`, 3 dans `tmdb_movie_genres`, ~16 dans `tmdb_movie_people` |
| Silver | IMDb est filtré sur le catalogue | Sa note du jour dans `imdb_ratings_daily` (`tt22084616`) |
| Publication | Les tables Silver sont copiées dans Postgres | `silver.tmdb_movies`… |
| Gold | dbt construit le catalogue | 1 ligne dans `dim_movie`, avec la note IMDb, la tranche de durée et le type `movie` |
| Gold | dbt calcule l'indice | `vraie_tendance` : « n°1 en tendance, et bien noté : 8.0/10 sur IMDb » |

## 5. Les principes de conception appliqués partout

| Principe | Mise en œuvre |
|---|---|
| **Architecture médaillon** | Bronze brut et rejouable → Silver propre → Gold métier |
| **Idempotence** | Partition du jour vidée puis réécrite ; MERGE sur clés métier ; `unique_key` dans les modèles incrémentaux ; date logique du run Airflow passée à chaque tâche |
| **Partitionnement par date** | `ingest_date=AAAA-MM-JJ` (MovieLens : `snapshot=<version>`) ; date en UTC |
| **Incrémental** | MERGE Delta en Silver ; modèles dbt incrémentaux pour les faits quotidiens |
| **Le grain et la clé** | Clé simple = état actuel (`tmdb_movies`) ; clé composite date + film = historique (`imdb_ratings_daily`) |
| **Qualité à chaque couche** | Seuil d'échec à l'ingestion, signature gzip, tests dbt (unicité, plages, relations, test métier), fraîcheur |
| **Fail fast** | `config.py` s'arrête avec un message clair si une variable manque |
| **Découplage** | Protocole S3 et noms génériques (`object-storage`, `S3_*`) : changer d'outil de stockage n'a pas touché au code |
| **Sécurité des secrets** | `.env` ignoré par Git et Docker (`.dockerignore`), secrets masqués à l'affichage |
| **Reproductibilité** | Versions fixées (images, Spark, Delta, dbt), Docker Compose, `pyproject.toml` |
| **Documentation** | Dictionnaire de données, ADR, récapitulatifs, docs et lignage dbt |

## 6. Les chiffres clés

| Mesure | Valeur |
|---|---|
| Sources | 3 (TMDB, IMDb, MovieLens) |
| Tables Silver | 9 (Delta) |
| Modèles dbt | 8 vues staging + 10 tables Gold |
| Fichier IMDb des notes | ~1,7 million de lignes par jour, filtrées à ~9 700 (0,6 %) |
| Notes MovieLens | 100 836 (610 utilisateurs) |
| Catalogue (`dim_movie`) | 9 753 titres, dont 9 085 films |
| Pépites cachées | 1 019 (v1) → **138** (v1.1), toutes des films |
| Ingestion TMDB | ~0,5 s par fiche, ~50 s pour 100 films |
| Run complet du DAG | **~4 min** (9 tâches, 74 modèles et tests dbt) |

## 7. Les incidents et les problèmes résolus (les meilleures histoires d'entretien)

| Situation | Résolution | Ce que ça montre |
|---|---|---|
| L'image MinIO est **supprimée de Docker Hub**, puis le registre de secours exige une authentification | Évaluation d'un fork, de Garage et de RustFS ; choix de RustFS, version fixée ; **aucun changement de code** grâce au protocole S3 | Évaluation d'outils, découplage |
| Spark n'arrive pas à écrire dans Postgres : « *No suitable driver* » | Nommer la classe du pilote JDBC (`org.postgresql.Driver`) | Débogage |
| dbt 1.9 affiché « *deprecated* » | Passage à la 1.12 (support actif), projet écrit sans avertissement pour être compatible v2 | Veille technologique, maintenabilité |
| Les « pépites » étaient surtout des épisodes de séries, alors que **tous les tests étaient verts** | Ingestion de `title.basics` (type de contenu), seuils resserrés, test métier | Analyse critique des résultats, qualité des données |
| 20 films MovieLens sans note ni type IMDb | Identifiants IMDb périmés (doublons fusionnés par IMDb) | Data discovery |
| Le classement du jour changeait entre deux ingestions | La dernière exécution fait foi (idempotence) → ingestion à heure fixe avec Airflow | Compréhension des données vivantes |
| *Insidious* (6,2) classé devant *Digger* (7,3) | Le rang tendance mesure l'attention, pas la qualité → justification de l'indice | Sens métier |
| Les messages du code invisibles dans les logs Airflow | La barre de progression de Spark (`
`) repoussait le texte hors de l'écran → `spark.ui.showConsoleProgress=false` | Débogage, lisibilité des logs |
| Le scheduler Airflow restait « *health: starting* » | Page de santé désactivée par défaut → `AIRFLOW__SCHEDULER__ENABLE_HEALTH_CHECK` | Lecture de la documentation, configuration |

## 8. Exécuter le pipeline

### Avec Airflow (mode normal)

```powershell
docker compose up -d          # RustFS, Postgres et Airflow
docker compose ps -a          # airflow-init : « Exited (0) » ; les autres services : « healthy »
```

Interface : http://localhost:8080 (compte `AIRFLOW_ADMIN_USER` / `AIRFLOW_ADMIN_PASSWORD` du `.env`).
Le DAG `cinematch_batch_daily` tourne seul chaque jour à 6 h UTC ; **Déclencher** lance un run immédiatement.
Logs d'une tâche : case de la tâche dans la grille → onglet **Journaux**. Détails dans le récapitulatif 06.

### À la main (débogage d'une étape)

```powershell
# 1. Ingestion → Bronze (sur le PC, .venv actif)
python -m cinematch.ingestion.tmdb --pages 5
python -m cinematch.ingestion.imdb
python -m cinematch.ingestion.movielens

# 2. Bronze → Silver (Spark, dans Docker) — silver_imdb en dernier
docker compose run --rm spark-jobs python -m cinematch.transform.silver_tmdb --date AAAA-MM-JJ
docker compose run --rm spark-jobs python -m cinematch.transform.silver_movielens
docker compose run --rm spark-jobs python -m cinematch.transform.silver_imdb --date AAAA-MM-JJ

# 3. Silver → Postgres
docker compose run --rm spark-jobs python -m cinematch.transform.publish_silver

# 4. Gold (dbt)
dotenv run -- dbt source freshness
dotenv run -- dbt build
dotenv run -- dbt docs generate
```

## 9. La couverture de la grille du PFE

| Compétence | État | Où |
|---|---|---|
| Ingestion de 2 à 3 sources | ✅ | `ingestion/` (3 sources) |
| Traitement batch | ✅ | Toute la chaîne |
| Data lake / lakehouse | ✅ | RustFS + Delta |
| Modélisation dimensionnelle | ✅ | `dbt/models/marts/` |
| ETL / ELT | ✅ | Spark (ETL) + dbt (ELT) |
| Tests de qualité des données | ✅ | Tests dbt, seuils à l'ingestion |
| Traitement incrémental | ✅ | MERGE Delta, modèles incrémentaux |
| Changements de schéma | ✅ (en partie) | Champ `softcore` apparu, `truncate`, renommages en staging |
| Lignage | ✅ | `dbt docs` |
| Conteneurisation Docker | ✅ | `docker-compose.yml`, images `spark-jobs` et `cinematch-airflow` |
| Documentation | ✅ | `docs/` |
| Orchestration | ✅ | Airflow, DAG `cinematch_batch_daily` |
| Monitoring et logs | ✅ en partie | Logs et historique des runs Airflow, reprises automatiques, fraîcheur dbt ; alertes à venir |
| Streaming | ⏳ | Kafka |
| Tests automatisés / CI-CD | ⏳ | GitHub Actions |
| Tableaux de bord et SQL analytique | ⏳ en partie | Requêtes sur l'étoile ; Metabase ou application web à venir |

**12 compétences sur 16 couvertes** (la grille en demande 6 à 8).

## 10. Les limites connues et la suite

| Limite | Piste |
|---|---|
| Pas d'alerte en cas d'échec d'un run | Notification Airflow (`on_failure_callback`), table de métriques des exécutions |
| Indice v1.1 : le buzz est la simple présence en tendance | **v2** : progression, avec l'export quotidien TMDB et l'historique des votes IMDb |
| Les films MovieLens n'ont ni genres TMDB ni acteurs | Récupérer leurs fiches TMDB |
| `dim_genre` limitée aux genres des films tendance | Appel `/genre/movie/list` |
| 20 identifiants IMDb périmés | Retrouver le nouvel identifiant via TMDB |
| `dim_movie` sans historique | SCD2 (snapshot dbt) |
| Lignage limité à dbt | OpenLineage (Spark + Airflow) |
| Pas de temps réel, pas d'interface | Kafka, recommandation (dont de groupe), API + application web, déploiement |

## 11. Les documents du projet

| Document | Contenu |
|---|---|
| `README.md` | Vision, innovations (recommandation de groupe, Radar Hype ou Pépite) |
| `ARCHITECTURE.md` | Architecture cible complète |
| `docs/data_dictionary.md` | Sources, tables, règles, licences |
| `docs/adr/0001` à `0004` | Décisions d'architecture |
| `docs/recap/01` → `06` | Le détail de chaque étape : ingestion, infrastructure Spark, Silver, Postgres + dbt, Gold, orchestration Airflow |
