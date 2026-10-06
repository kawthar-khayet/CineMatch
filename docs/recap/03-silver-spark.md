# Récapitulatif — Étape 2, bloc B : les transformations Bronze → Silver (Spark + Delta)

## 1. En une phrase

> « Avec PySpark, je transforme les données brutes de Bronze en 8 tables Silver au format Delta Lake :
> j'aplatis le JSON imbriqué de TMDB, je type et nettoie les données, j'harmonise les identifiants entre sources,
> et j'écris par MERGE sur des clés métier pour un traitement incrémental et idempotent. »

## 2. Ce qui a été construit

```
 BRONZE (fichiers bruts)                    SPARK                         SILVER (tables Delta)
 ───────────────────────                    ─────                         ─────────────────────
 tmdb/movie_details/*.jsonl  ──┐                                    ┌──►  tmdb_movies
 tmdb/trending/pages.jsonl   ──┴──► silver_tmdb.py ─────────────────┼──►  tmdb_movie_genres
                                                                    ├──►  tmdb_movie_people
                                                                    └──►  tmdb_trending_daily
 movielens/*.csv             ─────► silver_movielens.py ────────────┬──►  movielens_ratings
                                                                    ├──►  movielens_links
                                                                    └──►  movielens_movies
 imdb/title.ratings.tsv.gz   ─────► silver_imdb.py ─────────────────────►  imdb_ratings_daily
                                     (a besoin de tmdb_movies + movielens_links)
```

Code : `data-platform/src/cinematch/transform/` — `silver_tmdb.py`, `silver_movielens.py`, `silver_imdb.py`, `delta_io.py`.

Exécution (ordre à respecter : `silver_imdb` en dernier) :

```powershell
docker compose run --rm spark-jobs python -m cinematch.transform.silver_tmdb --date 2026-10-05
docker compose run --rm spark-jobs python -m cinematch.transform.silver_movielens
docker compose run --rm spark-jobs python -m cinematch.transform.silver_imdb --date 2026-10-05
```

## 3. Les tables Silver

| Table | Grain (« une ligne = … ») | Clé | Écriture |
|---|---|---|---|
| `tmdb_movies` | un film (état actuel) | `tmdb_id` | MERGE |
| `tmdb_movie_genres` | un film × un genre | `tmdb_id` + `genre_id` | MERGE |
| `tmdb_movie_people` | un film × une personne × un rôle | `tmdb_id` + `person_id` + `role` | MERGE |
| `tmdb_trending_daily` | un film, un jour donné (son rang) | `snapshot_date` + `tmdb_id` | MERGE |
| `imdb_ratings_daily` | un film, un jour donné (note et votes) | `snapshot_date` + `imdb_id` | MERGE |
| `movielens_ratings` | une note d'un utilisateur pour un film | — | Remplacement complet |
| `movielens_links` | un film MovieLens et ses identifiants IMDb / TMDB | — | Remplacement complet |
| `movielens_movies` | un film MovieLens (titre, genres) | — | Remplacement complet |

## 4. Les techniques Spark utilisées

### Aplatir le JSON imbriqué

| Opération | Rôle | Exemple dans le code |
|---|---|---|
| `spark.read.json` | Lire tous les fichiers d'une partition et déduire leur structure (schéma) | lecture de `movie_details` |
| `select` + notation pointée | Prendre des champs, même imbriqués | `F.col("g.name")`, `"credits.cast"` |
| `explode` | **Une liste devient plusieurs lignes** | `F.explode("genres")` : 1 film → 3 lignes de genres |
| `posexplode` | Comme `explode`, avec en plus la **position** de chaque élément | calcul du rang dans la liste tendance |
| `where` | Filtrer des lignes | `p.order < 15`, `p.job == "Director"` |
| `unionByName` | Assembler deux tables qui ont les mêmes colonnes | acteurs + réalisateurs |
| `groupBy` + `agg` | Regrouper et calculer | un film sur deux pages garde son meilleur rang (`min`) |

### Nettoyer et typer

| Transformation | Code | Pourquoi |
|---|---|---|
| Texte → date | `F.to_date("release_date")` | Pouvoir trier, filtrer, extraire l'année |
| Durée 0 → vide | `F.when(runtime > 0, runtime)` | TMDB écrit 0 quand la durée est inconnue |
| Date Unix → date et heure | `F.timestamp_seconds(...)` | MovieLens compte les secondes depuis 1970 |
| Renommer les notes | `tmdb_vote_average`, `imdb_rating` | Ne jamais confondre deux notes de sources différentes |
| Supprimer les doublons | `dropDuplicates([...])` | Un MERGE échoue si deux lignes entrantes ont la même clé |

### Harmoniser les identifiants entre sources

```python
F.concat(F.lit("tt"), F.lpad("imdbId", 7, "0"))   # MovieLens 1375666 → tt1375666 (IMDb, TMDB)
```

`lpad` complète à gauche avec des zéros jusqu'à 7 chiffres (`114709` → `tt0114709`).

### Filtrer un gros fichier avec une semi-jointure

```python
raw.join(catalog, raw.tconst == catalog.imdb_id, "left_semi")
```

Une **semi-jointure** garde les lignes qui ont une correspondance, **sans ajouter de colonnes** :
un filtre « ce film est-il dans mon catalogue ? ». Le catalogue = les `imdb_id` de `tmdb_movies` et de `movielens_links`.

### Lire un fichier compressé

```python
spark.read.option("header", True).option("sep", "\t").option("nullValue", "\\N").csv(...)
```

TSV (séparateur : tabulation), `\N` = valeur absente chez IMDb. **Spark décompresse le `.gz` tout seul.**

## 5. Le MERGE et le choix des clés

Le MERGE (`upsert_delta`) compare chaque ligne entrante à la table, sur une **clé** :
la ligne existe → **mise à jour** ; elle n'existe pas → **insertion** ; la table n'existe pas → **création**.

**Le choix de la clé décide de ce que la table conserve :**

| Clé | Ce que la table garde | Exemple |
|---|---|---|
| `tmdb_id` seul | **L'état actuel** : une ligne par film, mise à jour chaque jour | `tmdb_movies` |
| `snapshot_date` + `imdb_id` (**clé composite**) | **L'historique jour par jour** | `imdb_ratings_daily` |

Avec la clé composite :

| Situation | Le couple (jour, film) existe ? | Action |
|---|---|---|
| Nouveau jour | Non | Insertion : l'historique s'allonge (→ progression des votes pour le Radar) |
| Même jour relancé | Oui | Mise à jour : pas de doublon (→ idempotence) |

Avec `imdb_id` seul, chaque nouveau jour **écraserait** le précédent : plus d'historique, donc plus de progression.

## 6. Résultats obtenus (partition du 2026-10-05, `--pages 1`)

| Table | Lignes | Vérification |
|---|---|---|
| `tmdb_movies` | 20 | 1 ligne par film |
| `tmdb_movie_genres` | 53 | ~2,6 genres par film |
| `tmdb_movie_people` | 312 | 20 × 15 acteurs + ~12 réalisateurs |
| `tmdb_trending_daily` | 20 | rangs 1 à 20 |
| `movielens_ratings` | 100 836 | toutes les notes |
| `movielens_links` / `movielens_movies` | 9 742 | un film par ligne |
| `imdb_ratings_daily` | **9 736 sur 1 717 320** | le filtre garde 0,6 % du fichier IMDb |

## 7. Ce que les données ont appris

- **~26 films du catalogue n'ont pas de note IMDb** (9 736 notes pour ~9 762 identifiants) : films trop récents
  ou pas encore sortis, ou identifiants IMDb fusionnés depuis la publication de MovieLens.
  → En Gold, la note IMDb peut être **vide** : les tests de qualité doivent l'accepter.
- Le premier lancement de Spark télécharge 6 bibliothèques Java (Delta, S3A, SDK AWS) ; ensuite, le cache
  (`0 artifacts copied, 6 already retrieved`) évite tout nouveau téléchargement.
- Les messages `WARN` de Spark (`MetricsConfig`, `NativeCodeLoader`, `SparkStringUtils`) sont **sans gravité** :
  seuls `ERROR` et les `Exception` signalent un vrai problème.

## 8. Questions probables en entretien

| Question | Réponse courte |
|---|---|
| Comment aplatissez-vous du JSON imbriqué ? | `select` avec la notation pointée pour les objets, `explode` pour transformer les listes en lignes, puis filtres et typage. |
| Pourquoi un MERGE plutôt qu'un simple ajout ? | Pour être incrémental et idempotent : relancer un jour met à jour au lieu de dupliquer. |
| Comment choisissez-vous la clé d'un MERGE ? | Selon le grain voulu : clé simple pour l'état actuel, clé composite (date + id) pour garder l'historique. |
| Comment reliez-vous des sources différentes ? | Par des identifiants communs (`tmdb_id`, `imdb_id`), après harmonisation de leur format en Silver. |
| Pourquoi filtrer IMDb en Silver et pas à l'ingestion ? | Bronze garde le fichier complet (rejouable) ; le filtre dépend du catalogue, qui évolue. |
| Qu'est-ce qu'une semi-jointure ? | Une jointure qui sert de filtre : on garde les lignes qui ont une correspondance, sans ajouter de colonnes. |

## 9. Pour un entretien

> « Avec PySpark, je transforme le Bronze en Silver : aplatissement du JSON imbriqué de TMDB avec `explode`,
> typage et nettoyage, harmonisation des identifiants IMDb entre sources, puis écriture en Delta Lake par MERGE.
> Le choix de la clé détermine le grain : l'état actuel pour les films, l'historique quotidien pour les notes IMDb,
> que je filtre de 1,7 million à environ 10 000 lignes avec une semi-jointure sur mon catalogue. »
