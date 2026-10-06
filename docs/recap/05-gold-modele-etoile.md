# Récapitulatif — Étape 3, bloc C : la couche Gold (modèle en étoile et indice « Hype ou Pépite »)

## 1. En une phrase

> « Avec dbt, j'ai construit la couche Gold dans Postgres : un modèle en étoile (4 dimensions, 2 tables de pont,
> 3 faits, dont 2 incrémentaux) qui réunit TMDB, IMDb et MovieLens, et un premier indicateur métier,
> "Hype ou Pépite", qui croise le buzz et la qualité des films. Chaque modèle est testé, et le lignage
> est généré automatiquement. »

## 2. Où vit chaque couche

```
 RustFS (data lake)                          Postgres (entrepôt)
 ┌─────────────────────────┐                 ┌──────────────────────────────────┐
 │ lakehouse/bronze/  🥉   │                 │ schéma silver   (copie de Silver)│
 │ lakehouse/silver/  🥈   │ ── publication ─►│ schéma staging  (vues dbt)       │
 │                         │    Spark JDBC   │ schéma marts  🥇 = GOLD (dbt)     │
 └─────────────────────────┘                 └──────────────────────────────────┘
```

**Gold n'est pas dans RustFS : c'est voulu (ADR 0001).** Gold vit dans Postgres (schéma `marts`), où dbt, Metabase,
l'API et le frontend se connectent en SQL. (Dans le portage Databricks, Gold serait dans le lake, en Delta.)

## 3. Le modèle en étoile obtenu

```
                 dim_date                       dim_genre
                    │                               │
                    │                       bridge_movie_genre
                    │                               │
 fact_ratings ──────┼──────────────── dim_movie ────┴──── bridge_movie_person ──── dim_person
 fact_trending_daily┤                    │
 fact_imdb_ratings_daily ────────────────┘
                                         │
                                 mart_hype_or_gem (indicateur)
```

| Type | Modèle | Grain (« une ligne = … ») | Clé |
|---|---|---|---|
| Dimension | `dim_movie` | un film | `tmdb_id` |
| Dimension | `dim_person` | un acteur ou réalisateur | `person_id` |
| Dimension | `dim_genre` | un genre TMDB | `genre_id` |
| Dimension | `dim_date` | un jour (1995 → 2030) | `date_key` (ex. `20261006`) |
| Pont | `bridge_movie_person` | un film × une personne × un rôle | `tmdb_id` + `person_id` + `role` |
| Pont | `bridge_movie_genre` | un film × un genre | `tmdb_id` + `genre_id` |
| Fait | `fact_ratings` | une note d'un utilisateur pour un film | `user_id` + `movielens_movie_id` |
| Fait (incrémental) | `fact_trending_daily` | un film, un jour (rang tendance) | `snapshot_date` + `tmdb_id` |
| Fait (incrémental) | `fact_imdb_ratings_daily` | un film, un jour (note et votes IMDb) | `snapshot_date` + `tmdb_id` |
| Indicateur | `mart_hype_or_gem` | un film classé | `tmdb_id` |

## 4. Étape C1 — Les dimensions

### Le ménage préalable

| Action | Pourquoi |
|---|---|
| `fact_movie_rankings_daily.sql` renommé en `fact_trending_daily.sql` | Aligner le nom sur la table Silver |
| Modèles vides prévus pour plus tard déplacés dans `models/_later/`, avec `+enabled: false` dans `dbt_project.yml` | Un fichier de modèle vide fait échouer `dbt build` ; on les garde sans que dbt les construise |
| Test vide `assert_one_current_version_per_movie.sql` supprimé | Même raison ; il sera recréé avec l'historisation SCD2 |

### `stg_movielens__movies` : séparer le titre et l'année

MovieLens écrit « Inception (2010) ». Deux **expressions régulières** les séparent :

| Code | Résultat |
|---|---|
| `regexp_replace(title, '\s*\(\d{4}\)\s*$', '')` | `Inception` |
| `substring(title from '\((\d{4})\)\s*$')` | `2010` |

### `dim_movie` : réunir deux catalogues

**Le problème d'intégration** : les notes MovieLens portent sur ~9 700 films, mais seuls les 20 films tendance ont une fiche TMDB complète.
`dim_movie` réunit donc les deux catalogues pour que toutes les notes puissent s'y rattacher :

| Technique | Rôle |
|---|---|
| `full outer join` | Garder les films présents d'un seul côté ou des deux |
| `coalesce(tmdb.title, ml.title)` | Prendre la valeur TMDB si elle existe, sinon MovieLens (TMDB fait foi) |
| `distinct on (imdb_id) … order by snapshot_date desc` | La note IMDb **la plus récente** de chaque film (spécialité Postgres) |
| `case when … end as runtime_bucket` | Tranche de durée : `< 1h30`, `1h30 - 2h`, `> 2h`, `inconnue` |
| `has_tmdb_details` | Savoir d'où viennent les informations du film |

Limite : les films MovieLens n'ont ni genres TMDB ni acteurs → il faudra récupérer leurs fiches TMDB.

### Les autres dimensions

| Modèle | Technique clé |
|---|---|
| `dim_person` | `group by person_id` ; `bool_or(role = 'actor')` (vrai si au moins un rôle d'acteur) ; `count(distinct tmdb_id)` |
| `dim_genre` | `group by genre_id` (limite : seulement les genres des films tendance ; la liste complète viendra de `/genre/movie/list`) |
| `dim_date` | `generate_series` produit tous les jours de 1995 à 2030 ; `date_key` entier ; `is_weekend` |

## 5. Étape C2 — Les ponts et les faits

- **Tables de pont** : un film a plusieurs acteurs, un acteur joue dans plusieurs films → relation **plusieurs à plusieurs**,
  impossible à ranger dans `dim_movie`. `bridge_movie_person` est la base des **parcours de découverte**.
- **Faits** : des identifiants qui pointent vers les dimensions (`tmdb_id`, `date_key`) et des **mesures** (des nombres).
- **Un fait se relie à une dimension par la clé de celle-ci** : `fact_imdb_ratings_daily` traduit `imdb_id` en `tmdb_id`
  par une jointure avec `dim_movie` (les quelques notes sans film dans `dim_movie` sont écartées, et c'est documenté).

### Les modèles incrémentaux

```sql
{{ config(materialized='incremental', unique_key=['snapshot_date', 'tmdb_id']) }}

select … from …

{% if is_incremental() %}
where snapshot_date >= (select max(snapshot_date) from {{ this }})
{% endif %}
```

| Élément | Signification |
|---|---|
| `materialized='incremental'` | Ajouter ce qui est nouveau au lieu de tout reconstruire |
| `unique_key` | Clé composite : une ligne existante est remplacée, jamais dupliquée (comme le MERGE de Delta) |
| `is_incremental()` | Le filtre ne s'applique qu'à partir de la 2e exécution (la 1re prend tout) |
| `{{ this }}` | La table elle-même, telle qu'elle existe déjà |
| `>= max(snapshot_date)` | Reprendre au dernier jour connu (inclus), au cas où son ingestion aurait été relancée |

Intérêt : dans un an, 365 jours d'historique ; chaque matin, on ne traite qu'un jour.

### Les tests de relations

`relationships` vérifie que chaque identifiant d'un fait ou d'un pont **existe dans sa dimension** :
c'est l'**intégrité référentielle** (pas de « branche cassée » dans l'étoile).

## 6. Étape C3 — L'indice « Hype ou Pépite » (version 1)

### Les seuils sont des variables

```yaml
vars:
  true_trend_min_rating: 7.0
  misleading_max_rating: 6.0
  gem_min_rating: 7.5
  gem_min_votes: 1000
  gem_max_votes: 50000
```

Dans le SQL : `{{ var('gem_min_rating') }}`. On ajuste les seuils sans toucher au SQL, et on peut les tester à la volée :
`dotenv run -- dbt build --select mart_hype_or_gem --vars '{"misleading_max_rating": 6.5}'`.

### Les règles

| Catégorie | Règle |
|---|---|
| 🔥 `vraie_tendance` | En tendance et IMDb ≥ 7 |
| ⚠️ `buzz_trompeur` | En tendance et IMDb < 6 |
| `tendance_moyenne` | En tendance, IMDb entre 6 et 7 |
| `tendance_non_notee` | En tendance, sans note IMDb |
| 💎 `pepite_cachee` | Hors tendance, IMDb ≥ 7,5, entre 1 000 et 50 000 votes |

- **Minimum de 1 000 votes** : une note donnée par 12 personnes n'est pas fiable.
- **Maximum de 50 000 votes** : le film doit rester peu connu.
- Chaque film reçoit une **explication en français**, construite avec `||` (concaténation) :
  *« n°1 en tendance, et bien noté : 8.0/10 sur IMDb »*.

### Une version 1 honnête

Faute d'historique, le **buzz** est la simple **présence** dans la liste tendance, et la **notoriété** d'un film hors tendance
est approchée par son nombre de votes IMDb. La **version 2** mesurera la **progression** du buzz (export quotidien TMDB,
historique des votes IMDb, événements utilisateurs) : seules les règles changeront.

Exemple tiré des données : *Insidious* (n°2, IMDb 6,2) devant *Digger* (n°3, IMDb 7,3) → `tendance_moyenne` contre `vraie_tendance`.
**Le rang tendance mesure l'attention, pas la qualité** : c'est la justification de l'indice.

## 7. Le lignage

Le **lignage** (*data lineage*) est la traçabilité des données : d'où vient chaque table, par quelles transformations elle passe,
et qui l'utilise ensuite.

| Terme | Signification |
|---|---|
| En amont (*upstream*) | Ce dont une table dépend |
| En aval (*downstream*) | Ce qui dépend d'elle |

Usages : **déboguer** (remonter à l'origine d'un chiffre faux), **analyse d'impact** (quelles tables seront touchées si une source change),
documentation, conformité (RGPD).

dbt le construit automatiquement grâce à `{{ source(...) }}` et `{{ ref(...) }}` : chaque appel enregistre une dépendance,
qui sert à la fois à **construire dans le bon ordre** et à **dessiner le graphe**. On n'écrit donc jamais un nom de table en dur.

Limite : `dbt docs` ne voit pas la partie en amont (API → Bronze → Spark → Silver). Le lignage de bout en bout demanderait
un outil dédié (standard **OpenLineage**, compatible Spark et Airflow) → perspective.

Pour le voir : `dbt docs generate`, puis `dbt docs serve --port 8081` → **Projects → cinematch → models → marts**,
ouvrir un modèle, puis cliquer sur l'icône bleue en bas à droite (graphe).

## 8. Ce que dbt génère

| Où | Quoi |
|---|---|
| Postgres, schéma `staging` | 7 vues (aucune donnée copiée) |
| Postgres, schéma `marts` | 10 tables Gold (données stockées) |
| `data-platform/dbt/target/compiled/` | Le SQL « traduit » (les `ref()` remplacés par les vrais noms) |
| `data-platform/dbt/target/run/` | Le SQL exécuté, avec le `create table … as (…)` ajouté par dbt |
| `target/manifest.json` | La carte du projet (modèles, dépendances, tests) : base de la documentation et du lignage |
| `target/run_results.json` | Le bilan de la dernière exécution |

Les **tests** ne créent rien dans Postgres : ce sont des requêtes qui renvoient `PASS` ou `FAIL`.

## 9. Commandes utiles

```powershell
dotenv run -- dbt build                                         # tout construire et tester
dotenv run -- dbt build --select +mart_hype_or_gem              # un modèle et tout ce dont il dépend
dotenv run -- dbt build --select fact_trending_daily fact_imdb_ratings_daily   # rejouer l'incrémental
dotenv run -- dbt docs generate                                 # générer la documentation
dotenv run -- dbt docs serve --port 8081                        # l'ouvrir dans le navigateur
docker compose exec postgres psql -U cinematch -d cinematch -c "\dt marts.*"   # lister les tables Gold
```

Exemple de requête sur l'étoile (une mesure découpée par une dimension) :

```sql
SELECT d.is_weekend, round(avg(f.rating)::numeric, 2) AS note_moyenne, count(*) AS nb_notes
FROM marts.fact_ratings f
JOIN marts.dim_date d USING (date_key)
GROUP BY d.is_weekend;
```

## 10. Rappel : pourquoi « Connection refused »

Après un redémarrage, Docker Desktop et les conteneurs étaient arrêtés : dbt ne trouvait rien sur `localhost:5433`.
Réflexe : `docker compose ps`, puis `docker compose up -d`. Les données sont conservées dans les volumes.
Amélioration possible : `restart: unless-stopped` sur `object-storage` et `postgres`.

## 11. Questions probables en entretien

| Question | Réponse courte |
|---|---|
| Qu'est-ce qu'un modèle en étoile ? | Des faits au centre (événements et mesures) et des dimensions autour (qui, quoi, quand). |
| Pourquoi des tables de pont ? | Pour les relations plusieurs à plusieurs (films ↔ acteurs, films ↔ genres). |
| Qu'est-ce que le grain d'une table de faits ? | Ce que représente une ligne, par exemple « une note d'un utilisateur pour un film ». |
| Comment avez-vous intégré deux catalogues ? | `full outer join` + `coalesce`, avec une règle de priorité (TMDB fait foi) et un indicateur d'origine (`has_tmdb_details`). |
| Pourquoi des modèles incrémentaux ? | Ne traiter que les nouveaux jours ; `unique_key` évite les doublons si un jour est relancé. |
| Comment garantissez-vous l'intégrité référentielle ? | Des tests dbt `relationships` entre chaque fait ou pont et sa dimension. |
| Pourquoi les seuils sont-ils des variables ? | Ce sont des choix métier qu'on ajuste sans toucher au SQL. |
| Qu'est-ce que le lignage, et à quoi sert-il ? | La traçabilité des données ; il sert au débogage et à l'analyse d'impact, et dbt le génère avec `ref()` et `source()`. |
| Où est votre couche Gold ? | Dans Postgres (schéma `marts`) : choix documenté, pour que la BI et l'API s'y connectent simplement. |

## 12. Pour un entretien

> « Avec dbt, j'ai construit un modèle en étoile dans Postgres : un catalogue de films qui réunit TMDB et MovieLens
> avec la dernière note IMDb, des tables de pont pour les acteurs et les genres, et trois tables de faits, dont deux
> incrémentales pour l'historique quotidien. L'intégrité référentielle est testée automatiquement. Au-dessus, l'indice
> "Hype ou Pépite" croise le buzz et la qualité, avec des seuils paramétrables, et explique chaque classement. »

## 13. La suite

- **Airflow** : orchestrer toute la chaîne (ingestion → Silver → publication → dbt) chaque jour, à heure fixe.
- **API + page web** : exposer `mart_hype_or_gem` et le catalogue.
- Plus tard : export quotidien TMDB et version 2 de l'indice, fiches TMDB des films MovieLens, SCD2 sur `dim_movie`,
  streaming (Kafka), recommandation.
