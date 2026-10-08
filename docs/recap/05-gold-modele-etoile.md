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

### Les résultats obtenus (données du 2026-10-05, 1 page de tendances)

**Répartition par catégorie**

| Catégorie | Films |
|---|---|
| 💎 `pepite_cachee` | 1 019 |
| 🔥 `vraie_tendance` | 8 |
| `tendance_moyenne` | 7 |
| `tendance_non_notee` | 3 |
| ⚠️ `buzz_trompeur` | 2 |

**Les 20 films tendance**

| Rang | Film | Catégorie | Explication générée |
|---|---|---|---|
| 1 | Spider-Man: Brand New Day | vraie_tendance | n°1 en tendance, et bien noté : 8/10 sur IMDb |
| 2 | Insidious: Out of the Further | tendance_moyenne | n°2 en tendance, avec une note moyenne : 6.2/10 sur IMDb |
| 3 | Digger | vraie_tendance | n°3 en tendance, et bien noté : 7.3/10 sur IMDb |
| 4 | Verity | tendance_moyenne | n°4 en tendance, avec une note moyenne : 6.1/10 sur IMDb |
| 5 | The Uprising | tendance_moyenne | n°5 en tendance, avec une note moyenne : 6.2/10 sur IMDb |
| 6 | Resident Evil | vraie_tendance | n°6 en tendance, et bien noté : 7.6/10 sur IMDb |
| 7 | Avengers: Doomsday | tendance_non_notee | n°7 en tendance, pas encore assez noté sur IMDb |
| 8 | Obsession | vraie_tendance | n°8 en tendance, et bien noté : 7.8/10 sur IMDb |
| 9 | Other Mommy | tendance_non_notee | n°9 en tendance, pas encore assez noté sur IMDb |
| 10 | Runner | tendance_moyenne | n°10 en tendance, avec une note moyenne : 6.3/10 sur IMDb |
| 11 | Soulm8te | **buzz_trompeur** | n°11 en tendance, mais seulement 5.8/10 sur IMDb |
| 12 | Doing Life | tendance_moyenne | n°12 en tendance, avec une note moyenne : 6.1/10 sur IMDb |
| 13 | Primetime | vraie_tendance | n°13 en tendance, et bien noté : 7.2/10 sur IMDb |
| 14 | The Odyssey | vraie_tendance | n°14 en tendance, et bien noté : 8.4/10 sur IMDb |
| 15 | Moana | **buzz_trompeur** | n°15 en tendance, mais seulement 5.8/10 sur IMDb |
| 16 | Street Fighter | tendance_non_notee | n°16 en tendance, pas encore assez noté sur IMDb |
| 17 | Coyote vs. Acme | vraie_tendance | n°17 en tendance, et bien noté : 7.4/10 sur IMDb |
| 18 | Toy Story 5 | vraie_tendance | n°18 en tendance, et bien noté : 7.3/10 sur IMDb |
| 19 | Backrooms | tendance_moyenne | n°19 en tendance, avec une note moyenne : 6.7/10 sur IMDb |
| 20 | UNABOMBER | tendance_moyenne | n°20 en tendance, avec une note moyenne : 6.2/10 sur IMDb |

À noter : *The Odyssey* (n°14, IMDb 8,4) est le **mieux noté** des films tendance, alors que 13 films sont classés devant lui.

**Les 10 « pépites cachées » les mieux notées**

| Titre | Année | Note IMDb | Votes |
|---|---|---|---|
| Day of the Doctor, The | 2013 | 9,3 | 21 225 |
| The Godfather Trilogy: 1972-1990 | 1992 | 9,3 | 16 792 |
| Connections | 1978 | 9,3 | 1 656 |
| Frozen Planet | 2011 | 9,0 | 40 732 |
| Human Planet | 2011 | 9,0 | 34 395 |
| Civil War, The | 1990 | 9,0 | 26 647 |
| Sherlock - A Study in Pink | 2010 | 8,9 | 37 151 |
| O.J.: Made in America | 2016 | 8,9 | 24 212 |
| Human Condition III, The (Ningen no joken III) | 1961 | 8,8 | 9 174 |
| Doctor Who: The Waters of Mars | 2009 | 8,8 | 8 457 |

**Autres résultats**

| Requête | Résultat |
|---|---|
| Composition de `dim_movie` | 9 753 films : 20 avec fiche TMDB complète (17 avec note IMDb), 9 733 venant de MovieLens (9 713 avec note IMDb) |
| Note moyenne MovieLens, semaine / week-end | 3,49 (73 169 notes) / 3,52 (27 667 notes) : **pas de différence significative** |

### Ce que ces résultats apprennent (analyse critique de la version 1)

1. **Trop de « pépites » : 1 019 films.** Les seuils sont trop larges : une pépite doit être **rare**.
   → Resserrer les règles (note plus haute, ou ne garder que les meilleures d'un genre ou d'une période).
2. **Des « pépites » qui ne sont pas des films.** Le top 10 contient des **épisodes de séries** (*Doctor Who*, *Sherlock*),
   des **séries documentaires** (*Frozen Planet*, *Human Planet*, *The Civil War*) et une **compilation** (*Godfather Trilogy*).
   MovieLens contient aussi des contenus télévisés, et leurs notes IMDb sont souvent plus élevées que celles des films.
   → Il faut connaître le **type de contenu** (film, série, épisode…) : le fichier IMDb `title.basics` (colonne `titleType`)
   ou les fiches TMDB le fournissent. C'est un vrai **problème de qualité de données**, découvert grâce à l'analyse des résultats.
3. **Les catégories de tendance sont cohérentes** : 2 buzz trompeurs (*Soulm8te*, *Moana*, à 5,8), 3 films trop récents pour être notés
   (dont *Avengers: Doomsday*), et *The Odyssey* repéré comme le mieux noté malgré son 14e rang.
4. **Détail d'affichage** : une note de 8,0 s'affiche « 8/10 ». On pourra formater le nombre (`to_char`) pour toujours afficher une décimale.

**Leçon** : un indicateur ne se valide pas seulement par des tests techniques (tous verts ici) : il faut **regarder les résultats**
avec un œil métier. C'est cette analyse qui fait apparaître les vraies améliorations.

### La version 1.1 : les corrections apportées

| Correction | Où |
|---|---|
| Ingestion du fichier IMDb **`title.basics`** (~200 Mo : type de contenu, année, durée, genres) | `ingestion/imdb.py` (factorisé : une fonction `ingest_file` par fichier de la liste `DATASETS`) |
| Nouvelle table Silver **`imdb_titles`**, filtrée sur le catalogue (`left_semi`), publiée dans Postgres | `transform/silver_imdb.py` (option `quote = ""` : certains titres contiennent des guillemets), `publish_silver.py` |
| `dim_movie` : **`content_type`** et **`is_movie`** ; la durée IMDb complète celle de TMDB (`coalesce`) | `stg_imdb__titles.sql`, `dim_movie.sql` |
| Pépites réservées aux **films**, seuils resserrés (note ≥ **8,0**, **5 000 à 50 000** votes) | `mart_hype_or_gem.sql`, `dbt_project.yml` |
| Notes affichées avec une décimale (« 8.0/10 ») | `to_char(imdb_rating, 'FM90.0')` |
| **Test singulier** `assert_gems_are_movies.sql` : la requête doit renvoyer **zéro ligne** | `data-platform/dbt/tests/` |

Un **test singulier** est une requête écrite à la main qui vérifie une **règle métier** : chaque ligne renvoyée est une erreur.
Ce test aurait détecté le défaut de la version 1 ; il empêche désormais toute régression.

Au passage : `pyproject.toml` décrit maintenant le projet (paquet `cinematch` dans `data-platform/src`), installé une fois avec
`pip install -e .` (mode éditable) → plus besoin de `PYTHONPATH` sur le PC.

### Résultats : version 1 contre version 1.1

| Mesure | Version 1 | Version 1.1 |
|---|---|---|
| Pépites cachées | 1 019 | **138** |
| Pépites qui ne sont pas des films | Le top 10 en contenait **8** | **0** (garanti par le test) |
| Films à durée inconnue dans `dim_movie` | ~9 733 (tous les films MovieLens) | **21** (durée IMDb en complément) |
| Affichage de la note | « 8/10 » | « 8.0/10 » |
| Jours de notes IMDb dans `fact_imdb_ratings_daily` | 1 | **2** (9 730 notes par jour) : l'historique des votes commence |

**Le nouveau top 10 des pépites cachées** (que des films, pour la plupart des documentaires et des classiques peu connus)

| Titre | Année | Note IMDb | Votes |
|---|---|---|---|
| O.J.: Made in America | 2016 | 8,9 | 24 215 |
| Human Condition III, The (Ningen no joken III) | 1961 | 8,8 | 9 176 |
| Stop Making Sense | 1984 | 8,7 | 24 603 |
| Earthlings | 2006 | 8,6 | 20 657 |
| Human | 2015 | 8,6 | 9 291 |
| Dear Zachary: A Letter to a Son About His Father | 2008 | 8,5 | 46 873 |
| Baraka | 1992 | 8,5 | 43 562 |
| Trou, Le (Hole, The) (Night Watch, The) | 1960 | 8,5 | 24 319 |
| Home | 2009 | 8,5 | 23 371 |
| Human Condition I, The (Ningen no joken I) | 1959 | 8,5 | 11 783 |

**Les types de contenu du catalogue** (`dim_movie`) : 9 085 films (`movie`), 170 vidéos, 168 téléfilms (`tvMovie`), 104 courts métrages,
79 mini-séries, 79 émissions spéciales, 32 épisodes, 10 courts métrages TV, 6 séries, et **20 sans type**.

**Les 20 titres sans type** sont des films MovieLens dont l'identifiant IMDb **n'existe plus** (ex. *Confessions of a Dangerous Mind*,
`tt0290538`) : IMDb fusionne parfois des doublons et change leur identifiant, alors que MovieLens garde l'ancien.
Ce sont les mêmes films qui n'ont pas de note IMDb. Les 20 films TMDB, eux, ont tous leur type.

**Une note qui bouge** : *Verity* est passé de 6,1 à 6,0 sur IMDb entre le 5 et le 6 octobre. C'est le premier signe de l'historique
quotidien, qui permettra la version 2 de l'indice (la progression).

**Pistes restantes** : 138 pépites restent nombreuses ; on pourrait garder les meilleures par genre ou par décennie, ou les croiser
avec les goûts de l'utilisateur (c'est le rôle de la recommandation).

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
