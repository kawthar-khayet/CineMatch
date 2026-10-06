# Récapitulatif — Étape 3, blocs A et B : Postgres, publication de Silver, dbt et couche staging

## 1. En une phrase

> « J'ai ajouté un entrepôt Postgres à la plateforme : Spark y publie les tables Silver par JDBC, puis dbt
> les transforme en SQL, avec des tests de qualité automatiques et un contrôle de fraîcheur des données.
> C'est la partie ELT du pipeline, après la partie ETL réalisée avec Spark. »

## 2. Ce qui a été construit

```
 Silver (Delta, RustFS) ──► Postgres, schéma silver ──► dbt ──► Postgres, schéma staging (vues)
                        Spark JDBC                     SQL + tests            ↓
                        (publish_silver)                                 bloc C : schéma marts (Gold)
```

| Bloc | Étape | Contenu | Fichiers |
|---|---|---|---|
| A | A1 | Démarrer Postgres | `docker-compose.yml` (service `postgres`), `data-platform/docker/postgres/init.sql`, `.env.example` |
| A | A2 | Connecter Spark à Postgres | `config.py` (`jdbc_url`), `spark_session.py` (pilote JDBC), `docker-compose.yml` |
| A | A3 | Publier les 8 tables Silver | `transform/delta_io.py` (`publish_to_warehouse`), `transform/publish_silver.py` |
| B | B1 | Installer et configurer dbt | `requirements.txt`, `data-platform/dbt/` : `dbt_project.yml`, `profiles.yml`, `packages.yml`, `macros/generate_schema_name.sql` |
| B | B2 | Sources et couche staging | `models/staging/_sources.yml`, 6 modèles `stg_*.sql`, `_staging.yml` (tests) |

**Pourquoi Postgres pour Gold ?** (ADR 0001) dbt, Metabase et l'API s'y branchent très simplement.
On copie donc Silver dans Postgres, puis dbt transforme sur place, en SQL.

## 3. Bloc A — Postgres et publication de Silver

### A1. Le service Postgres

| Élément | Rôle |
|---|---|
| `image: postgres:16` | Image officielle, version majeure 16 (correctifs 16.x seulement : stable et reproductible) |
| `POSTGRES_USER / PASSWORD / DB` (depuis `.env`) | Compte administrateur et base `cinematch`, créés automatiquement au premier démarrage |
| Port `5433:5432` | 5433 côté PC pour éviter un conflit avec un Postgres déjà installé ; 5432 dans le réseau Docker |
| Volume `postgres-data` | Les données survivent à l'arrêt ou à la suppression du conteneur |
| `init.sql` monté dans `/docker-entrypoint-initdb.d/` (`:ro`) | Exécuté **une seule fois**, à la création de la base : crée le schéma `silver` |
| `healthcheck` (`pg_isready`) | Docker sait quand Postgres accepte vraiment des connexions |

Vérification : `docker compose exec postgres psql -U cinematch -d cinematch -c "\dn"` → schémas `public` et `silver`.

### A2. Spark parle à Postgres (JDBC)

- **JDBC** (*Java Database Connectivity*) : la façon standard dont un programme Java parle à une base de données.
  Spark étant en Java, il utilise JDBC. Adresse : `jdbc:postgresql://<hôte>:<port>/<base>` (propriété `jdbc_url` de `config.py`).
- **Le pilote** `org.postgresql:postgresql:42.7.4` est ajouté aux bibliothèques Java de Spark (comme S3A).
- **Piège rencontré : « No suitable driver ».** Quand le pilote est ajouté par `spark.jars.packages`, Java ne le
  découvre pas toujours seul : il faut nommer sa classe avec l'option `driver = org.postgresql.Driver`.
- **Même piège qu'avec S3** : depuis le PC, Postgres est à `localhost:5433` ; depuis un conteneur, à `postgres:5432`.
  `docker-compose.yml` remplace donc `POSTGRES_HOST` et `POSTGRES_PORT` pour le service `spark-jobs`.
- `depends_on` avec `condition: service_healthy` : Spark attend que Postgres soit **prêt**, pas seulement démarré.

### A3. Publier Silver dans Postgres

`publish_to_warehouse(spark, table)` lit une table Delta et l'écrit dans `silver.<table>` en JDBC,
avec `mode("overwrite")` + **`truncate = true`** :

| Sans `truncate` | Avec `truncate` |
|---|---|
| Spark supprime la table (`DROP`) puis la recrée : impossible si des vues dbt en dépendent | Spark vide la table (`TRUNCATE`) puis la recharge : les vues dbt restent valides |

Contrepartie : si une colonne apparaît dans Silver, la table Postgres garde son ancienne structure → la publication
échoue, et il faut supprimer la table à la main (exemple concret de **changement de schéma**).

**JDBC ne sait pas écrire de listes ni d'objets imbriqués** : c'est l'aplatissement fait en Silver (bloc B de l'étape 2)
qui rend cette publication possible.

Résultat : les 8 tables publiées, avec les mêmes nombres de lignes qu'en Silver.

## 4. Bloc B — dbt et la couche staging

### Qu'est-ce que dbt ?

**dbt** (*data build tool*) permet d'écrire les transformations **en SQL**, une table par fichier.
dbt gère l'**ordre** d'exécution, les **tests** de qualité, la **documentation** et le **lignage**.

### B1. La configuration

| Fichier | Rôle |
|---|---|
| `dbt_project.yml` | Carte d'identité du projet : emplacements, et matérialisation par dossier (`staging` → vues, `marts` → tables) |
| `profiles.yml` | Connexion à Postgres, uniquement par `env_var(...)` : aucun secret dans le fichier |
| `packages.yml` | Paquet `dbt_utils` (tests comme `accepted_range`), installé avec `dbt deps` |
| `macros/generate_schema_name.sql` | Une macro Jinja pour nommer les schémas `staging` et `marts` (au lieu de `analytics_staging`…) |

**Vue ou table ?**

| Matérialisation | Ce que c'est | Utilisée pour |
|---|---|---|
| Vue (`view`) | Une requête enregistrée, recalculée à chaque lecture, sans copie de données | Staging : simple nettoyage, toujours à jour |
| Table (`table`) | Le résultat stocké | Marts : jointures plus lourdes, lues souvent par la BI et l'API |

**dbt ne lit pas le fichier `.env`.** On utilise la commande de `python-dotenv[cli]` :

```powershell
dotenv run -- dbt debug      # charge .env, puis lance dbt
```

`DBT_PROJECT_DIR` et `DBT_PROFILES_DIR` (dans `.env`) indiquent à dbt où se trouvent le projet et `profiles.yml` :
on lance dbt depuis la racine du projet.

### B2. Les sources et les modèles staging

- **`_sources.yml`** déclare les 8 tables du schéma `silver` (avec leurs descriptions).
- **`{{ source('silver', 'tmdb_movies') }}`** : dbt remplace l'expression par le vrai nom de la table **et retient la dépendance**,
  ce qui construit le **lignage**.
- **Convention de nommage** : `stg_<source>__<table>` (deux underscores).

| Modèle | Ce qu'il fait |
|---|---|
| `stg_tmdb__movies` | Renomme `popularity` → `tmdb_popularity`, `adult` → `is_adult` (un booléen commence par `is_`) |
| `stg_tmdb__movie_genres` | Sélection des colonnes |
| `stg_tmdb__movie_people` | Sélection des colonnes |
| `stg_tmdb__trending_daily` | Renomme `rank` → `trending_rank` (`rank` est un mot réservé du SQL) |
| `stg_imdb__ratings_daily` | Sélection des colonnes |
| `stg_movielens__ratings` | Relie chaque note à son `tmdb_id` et son `imdb_id` (CTE + `left join` sur `movielens_links`) |

**CTE** (`with … as (…)`) : des sous-requêtes nommées, lisibles de haut en bas. C'est le style recommandé par dbt.

### Les tests de qualité (`_staging.yml`)

| Test | Ce qu'il vérifie |
|---|---|
| `unique`, `not_null` | Une clé unique et toujours renseignée |
| `dbt_utils.unique_combination_of_columns` | Pas de doublon sur une clé composite (ex. même film, même jour) |
| `accepted_values` | Seulement les valeurs prévues (`actor`, `director`) |
| `dbt_utils.accepted_range` | Notes TMDB 0–10, IMDb 1–10, MovieLens 0,5–5, rang ≥ 1 |

Pas de `not_null` sur `imdb_id` ni `imdb_rating` : certains films n'en ont pas (les ~26 films sans note IMDb).
**Un test vérifie une règle réelle, pas une règle idéale.**

Un test dbt est une requête : s'il trouve des lignes qui violent la règle, il échoue.

### La fraîcheur des données

`dbt source freshness` avertit si `silver.tmdb_movies` n'a pas été rechargée depuis plus de 2 jours
(colonne `ingested_at`). C'est une première brique du **monitoring** : savoir si le pipeline s'est arrêté.

### La mise à jour vers dbt 1.12

dbt 1.9 affichait « *This version of dbt is deprecated* » (plus de correctifs). Versions en octobre 2026 :

| Version | Statut |
|---|---|
| v2.0 (septembre 2026) | Nouveau moteur en Rust (« Fusion ») ; tout ce qui était obsolète en 1.x devient une erreur |
| **v1.12 (juillet 2026)** | **Support actif jusqu'en juillet 2027 — retenue** |
| v1.11 | Support critique seulement |
| v1.10, v1.9 | Obsolètes |

**Choix : dbt 1.12**, stable et maintenue, en écrivant le projet **sans avertissement**, donc compatible v2.
Changement de syntaxe : les paramètres des tests passent sous une clé `arguments:`.

```yaml
- dbt_utils.accepted_range:
    arguments:
      min_value: 0
      max_value: 10
```

Dans `requirements.txt` : `dbt-core~=1.12.0` (toute 1.12.x, jamais 1.13 ni 2.0) et `dbt-postgres` sans version
(depuis dbt 1.8, l'adaptateur a sa propre numérotation : pip choisit la version compatible).

## 5. Résultats obtenus

| Vérification | Résultat |
|---|---|
| Schémas Postgres | `public`, `silver` (puis `staging`) |
| Publication des 8 tables Silver | Mêmes nombres de lignes qu'en Silver |
| `dbt build --select staging` | `PASS=20` : 6 vues + 14 tests, tous verts |
| `dbt source freshness` | `PASS` |

## 6. Ce que les données ont appris

- **Le rang tendance n'est pas la qualité** : *Insidious* (IMDb 6,2) était classé devant *Digger* (IMDb 7,3).
  La liste tendance mesure l'attention, pas la qualité → c'est la justification de l'indice **Hype ou Pépite**.
- **Un instantané quotidien dépend de l'heure de capture** : relancer l'ingestion le même jour a remplacé le classement
  de 20:46 par celui de 21:09 (idempotence : la dernière exécution fait foi) → en production, ingestion **à heure fixe**.

## 7. Commandes utiles

```powershell
docker compose up -d                                                                  # démarrer RustFS et Postgres
docker compose run --rm spark-jobs python -m cinematch.transform.publish_silver       # publier Silver dans Postgres
dotenv run -- dbt debug                                                               # tester la connexion de dbt
dotenv run -- dbt deps                                                                # installer dbt_utils
dotenv run -- dbt build --select staging                                              # construire et tester la couche staging
dotenv run -- dbt source freshness                                                    # contrôler la fraîcheur des sources
docker compose exec postgres psql -U cinematch -d cinematch -c "\dv staging.*"        # lister les vues staging
```

## 8. Questions probables en entretien

| Question | Réponse courte |
|---|---|
| Pourquoi copier Silver dans Postgres ? | Gold vit dans Postgres, où dbt, la BI et l'API se branchent simplement (choix documenté dans l'ADR 0001). |
| ETL ou ELT ? | Les deux : Spark structure et nettoie avant de charger (ETL), dbt transforme dans l'entrepôt en SQL (ELT). |
| À quoi sert dbt ? | Écrire les transformations en SQL versionné, avec l'ordre d'exécution, les tests, la documentation et le lignage gérés automatiquement. |
| Vue ou table ? | Vue pour un nettoyage léger toujours à jour ; table pour des résultats lourds et souvent lus. |
| Comment testez-vous la qualité des données ? | Tests dbt sur chaque modèle : unicité, non-nullité, valeurs acceptées, plages, et fraîcheur des sources. |
| Pourquoi `truncate` lors de la publication ? | Pour ne pas supprimer une table dont dépendent des vues dbt. |
| Pourquoi dbt 1.12 et pas la v2 ? | La v2 venait de sortir avec un nouveau moteur ; la 1.12 est maintenue, et le projet est écrit pour être compatible v2. |

## 9. Pour un entretien

> « Spark publie les tables Silver dans Postgres par JDBC, puis dbt construit la couche Gold en SQL. Chaque modèle
> est testé automatiquement (unicité, plages de valeurs, combinaisons de clés) et un contrôle de fraîcheur signale
> un pipeline arrêté. J'ai aussi choisi une version de dbt maintenue, en écrivant le projet de façon compatible
> avec la v2. »

---

## 10. Prochaine étape — C1 : les dimensions (à faire)

0. **Ménage** : renommer `fact_movie_rankings_daily.sql` en `fact_trending_daily.sql` ; déplacer les modèles vides prévus
   pour plus tard (`dim_user`, `fact_user_events`, `mart_movie_momentum`, `mart_recommendations`, `stg_events__user_events`)
   dans `models/_later/`, désactivé dans `dbt_project.yml` ; supprimer le test vide `assert_one_current_version_per_movie.sql`.
1. **`stg_movielens__movies`** : les titres MovieLens.
2. **`dim_movie`** : 1 ligne par film (`tmdb_id`), réunissant les films TMDB (fiche complète) et les films MovieLens
   (titre et année extraite du titre), avec la dernière note IMDb, `runtime_bucket` et `has_tmdb_details`.
   Limite : les films MovieLens n'ont ni genres TMDB ni acteurs → récupérer plus tard leurs fiches TMDB.
3. **`dim_person`**, **`dim_genre`**, **`dim_date`** (1995 → 2030, générée avec `generate_series`).
4. **Tests** dans `_marts.yml`, puis `dotenv run -- dbt build --select staging marts`.

Ensuite : C2 (ponts et faits), C3 (Hype ou Pépite + `dbt docs`).
