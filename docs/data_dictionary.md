# Dictionnaire de données — CineMatch

> Document de référence sur les données du projet : sources, champs conservés, tables Silver,
> règles de réconciliation et licences. Toute modification des données commence par une mise à jour de ce fichier.

---

## 1. Journal des décisions

| # | Décision | Choix retenu | Date |
|---|---|---|---|
| D1 | Sources de données | TMDB, IMDb, MovieLens, événements simulés | 2026-10-04 |
| D2 | IMDb | Uniquement `title.ratings` (téléchargé chaque jour) | 2026-10-04 |
| D3 | MovieLens | `ml-latest-small` pour démarrer (semaine 1), puis `ml-32m` filtré (semaine 2) | 2026-10-04 |
| D4 | Moteur de recommandation | Hybride : collaboratif (MovieLens) + contenu (TMDB) + tendances | 2026-10-04 |
| D5 | Langue des données TMDB | Anglais (`en-US`) | 2026-10-04 |
| D6 | Où regarder | Oui : plateformes de **tous les pays** stockées ; le pays est choisi à l'affichage | 2026-10-04 |
| D7 | Wikipédia | Retirée → perspectives | 2026-10-04 |
| D8 | Critiques TMDB | Hors périmètre | 2026-10-04 |
| D9 | API FastAPI, portage Databricks | Retirés du mois → perspectives | 2026-10-04 |
| D10 | Inscriptions d'utilisateurs | **RandomUser** (profils fictifs) → topic Kafka `user_signups` | 2026-10-04 |
| D11 | Actions des utilisateurs | Générateur maison, guidé par 6 règles de réalisme (§9) → topic `user_events` | 2026-10-04 |

---

## 2. Vue d'ensemble des sources

| Source | Type d'accès | Fréquence | Volume | Rôle | Clé de jointure |
|---|---|---|---|---|---|
| TMDB — classements | API REST (JSON) | Chaque jour | ~200 films par jour | Signal de tendance | `tmdb_id` |
| TMDB — fiches films | API REST (JSON) | Chaque jour (nouveaux films et mises à jour) | ~2 000 films au départ, croissant | **Catalogue** | `tmdb_id`, `imdb_id` |
| TMDB — où regarder | API REST (JSON) | Chaque semaine | 1 appel par film (tous les pays) | Disponibilité sur les plateformes | `tmdb_id` |
| IMDb — `title.ratings` | Fichier TSV compressé officiel | Chaque jour | Fichier complet, filtré sur le catalogue | Note de référence + progression des votes | `imdb_id` |
| MovieLens | Fichiers CSV (ZIP) | Une seule fois | small : ~100 000 notes · 32M : ~32 millions | Goûts des utilisateurs, évaluation | `tmdb_id`, `imdb_id` (via `links.csv`) |
| RandomUser — inscriptions | API REST → Kafka (`user_signups`), **profils fictifs** | En continu | Quelques inscriptions par minute | Nouveaux utilisateurs, pays, démarrage à froid | `user_id` |
| Événements utilisateurs | Générateur maison → Kafka (`user_events`), **simulés** | En continu | Quelques événements par seconde | Temps réel | `tmdb_id`, `user_id` |

**Clé pivot du projet : `tmdb_id`.** IMDb se relie au catalogue par `imdb_id`, fourni par TMDB.

---

## 3. Détail par source

### 3.1 TMDB — classements
- **Appels** : `/trending/movie/day` et `/movie/popular`, 5 pages chacun (configurable).
- **Bronze** : `bronze/tmdb/rankings/ingest_date=YYYY-MM-DD/`
- **Champs conservés** : `id`, rang (calculé), `popularity`, `vote_average`, `vote_count`, nom du classement.

### 3.2 TMDB — fiches films
- **Appel** : `/movie/{id}?append_to_response=credits&language=en-US`
- **Films concernés** : ceux des classements du jour + les films MovieLens (2 000 au départ, configurable).
- **Bronze** : `bronze/tmdb/movie_details/ingest_date=YYYY-MM-DD/` (JSON Lines, 100 films par fichier)
- **Règles** : 15 premiers rôles du casting ; dans l'équipe, **réalisateurs uniquement**.

### 3.3 TMDB — où regarder
- **Appel** : `/movie/{id}/watch/providers` (renvoie tous les pays en une seule réponse).
- **Bronze** : `bronze/tmdb/watch_providers/ingest_date=YYYY-MM-DD/`
- **Types d'offre** : `flatrate` (abonnement), `rent` (location), `buy` (achat), `free` (gratuit), `ads` (gratuit avec publicité).
- **Attention** : données fournies par **JustWatch**, à citer obligatoirement. La couverture varie selon les pays (à vérifier pour le Maroc lors de l'étape 1).

### 3.4 IMDb — `title.ratings`
- **Fichier** : `https://datasets.imdbws.com/title.ratings.tsv.gz`, mis à jour chaque jour.
- **Colonnes** : `tconst` (ex. `tt1375666`), `averageRating`, `numVotes`.
- **Bronze** : `bronze/imdb/title_ratings/ingest_date=YYYY-MM-DD/`
- **Règle** : en Silver, on ne garde que les films présents dans le catalogue TMDB.

### 3.5 MovieLens
- **Fichiers** : `ratings.csv`, `links.csv`, `movies.csv` (vérification), `tags.csv` (optionnel).
- **Bronze** : `bronze/movielens/<fichier>/snapshot=<version>/`
- **Versions** : `ml-latest-small` (1996-2018) → `ml-32m` (1995 → octobre 2023).
- **Filtre pour `ml-32m`** (proposé, ajustable) : notes à partir du 2015-01-01.

### 3.6 RandomUser — inscriptions (simulées)
- **API** : `https://randomuser.me/api/` (gratuite, sans clé). On demande les profils par lots, puis on les publie progressivement.
- **Topic Kafka** : `user_signups`
- **Bronze** : `bronze/events/user_signups/event_date=YYYY-MM-DD/` (Delta)
- **Champs conservés** : identifiant UUID, genre, âge, pays, nationalité, date d'inscription. Le nom, l'e-mail et la photo ne sont **pas** conservés : inutiles, et c'est une bonne habitude de minimiser les données personnelles, même fictives.
- **Règles** :
  - chaque nouvel inscrit reçoit un `user_id` **à partir de 1 000 000**, pour ne jamais entrer en collision avec les identifiants MovieLens ;
  - à l'inscription, le générateur lui attribue 2 ou 3 **genres préférés** (tirés au hasard) ;
  - l'âge, le genre et le pays sont **aléatoires** : ils ne servent **jamais** à recommander, seulement à l'affichage, à « où regarder » et aux tableaux de bord.
- **Limite** : une vingtaine de nationalités disponibles, sans le Maroc.

### 3.7 Événements utilisateurs (simulés)
- **Producteur** : générateur maison (`streaming/producer.py`), selon les règles du §9.
- **Topic Kafka** : `user_events`
- **Bronze** : `bronze/events/user_events/event_date=YYYY-MM-DD/` (Delta)
- **Types** : `search`, `view_details`, `play_trailer`, `add_watchlist`, `rate`.
- **Utilisateurs concernés** : les identifiants MovieLens **et** les nouveaux inscrits (RandomUser).

---

## 4. Tables Silver

### `tmdb_movies` — 1 ligne par film
| Colonne | Type | Description |
|---|---|---|
| `tmdb_id` | entier | Identifiant TMDB (**clé**) |
| `imdb_id` | texte | Identifiant IMDb, format `tt1234567` |
| `title` | texte | Titre (anglais) |
| `original_title` | texte | Titre original |
| `original_language` | texte | Langue originale (code ISO, ex. `en`, `fr`) |
| `release_date` | date | Date de sortie |
| `runtime_minutes` | entier | Durée en minutes (vide si inconnue) |
| `tmdb_vote_average` | décimal | Note TMDB (0-10) |
| `tmdb_vote_count` | entier | Nombre de votes TMDB |
| `popularity` | décimal | Popularité TMDB du jour d'ingestion |
| `status` | texte | `Released`, `Post Production`… |
| `overview` | texte | Résumé |
| `ingested_at` | horodatage | Date et heure d'ingestion |

### `tmdb_movie_genres` — 1 ligne par film × genre
| Colonne | Type | Description |
|---|---|---|
| `tmdb_id` | entier | Film (**clé**, avec `genre_id`) |
| `genre_id` | entier | Identifiant du genre |
| `genre_name` | texte | Nom du genre (anglais) |

### `tmdb_movie_people` — 1 ligne par film × personne × rôle
| Colonne | Type | Description |
|---|---|---|
| `tmdb_id` | entier | Film |
| `person_id` | entier | Identifiant TMDB de la personne |
| `person_name` | texte | Nom |
| `role` | texte | `actor` ou `director` |
| `character_name` | texte | Personnage (acteurs uniquement) |
| `cast_order` | entier | Ordre au générique (0 = premier rôle) |
| `person_popularity` | décimal | Popularité TMDB de la personne |

### `tmdb_rankings_daily` — 1 ligne par jour × classement × film
| Colonne | Type | Description |
|---|---|---|
| `snapshot_date` | date | Jour du classement |
| `list_name` | texte | `trending_day` ou `popular` |
| `rank` | entier | Position dans le classement |
| `tmdb_id` | entier | Film |
| `popularity` | décimal | Popularité ce jour-là |

### `tmdb_watch_providers` — 1 ligne par jour × film × pays × plateforme × type d'offre
| Colonne | Type | Description |
|---|---|---|
| `snapshot_date` | date | Jour de l'ingestion |
| `tmdb_id` | entier | Film |
| `country_code` | texte | Pays (ISO, ex. `FR`, `MA`) |
| `provider_id` | entier | Identifiant de la plateforme |
| `provider_name` | texte | Netflix, Prime Video… |
| `offer_type` | texte | `flatrate`, `rent`, `buy`, `free`, `ads` |
| `display_priority` | entier | Ordre d'affichage conseillé |

### `imdb_ratings_daily` — 1 ligne par jour × film
| Colonne | Type | Description |
|---|---|---|
| `snapshot_date` | date | Jour du fichier IMDb |
| `imdb_id` | texte | `tt1234567` |
| `imdb_rating` | décimal | Note moyenne (0-10) |
| `imdb_num_votes` | entier | Nombre total de votes |

### `movielens_ratings` — 1 ligne par utilisateur × film
| Colonne | Type | Description |
|---|---|---|
| `user_id` | entier | Utilisateur MovieLens (anonyme) |
| `movielens_movie_id` | entier | Film (identifiant MovieLens) |
| `rating` | décimal | Note de 0,5 à 5 |
| `rated_at` | horodatage | Date de la note (convertie depuis le format Unix) |

### `movielens_links` — 1 ligne par film MovieLens
| Colonne | Type | Description |
|---|---|---|
| `movielens_movie_id` | entier | Identifiant MovieLens |
| `imdb_id` | texte | **Harmonisé** : `1375666` → `tt1375666` |
| `tmdb_id` | entier | Identifiant TMDB (vide pour quelques films) |

### `user_profiles` — 1 ligne par nouvel inscrit
| Colonne | Type | Description |
|---|---|---|
| `user_id` | entier | Identifiant CineMatch (≥ 1 000 000) (**clé**) |
| `external_uuid` | texte | Identifiant fourni par RandomUser |
| `gender` | texte | Genre (fictif) |
| `age` | entier | Âge (fictif) |
| `country_code` | texte | Pays (ISO), utilisé pour « où regarder » |
| `favorite_genres` | texte | Genres préférés attribués à l'inscription |
| `signed_up_at` | horodatage | Date et heure d'inscription |

### `user_events` — 1 ligne par événement
| Colonne | Type | Description |
|---|---|---|
| `event_id` | texte | Identifiant unique (**clé** de dédoublonnage) |
| `event_type` | texte | Type d'action |
| `session_id` | texte | Session à laquelle appartient l'action |
| `user_id` | entier | Utilisateur |
| `tmdb_id` | entier | Film (vide pour une recherche) |
| `search_query` | texte | Texte recherché (seulement pour `search`) |
| `rating` | décimal | Note (seulement pour `rate`) |
| `event_ts` | horodatage | Date et heure de l'action |
| `received_ts` | horodatage | Date et heure de réception par Kafka (sert à repérer les retards) |

---

## 5. Source de référence (en cas de conflit)

| Information | Source de référence | Remarque |
|---|---|---|
| Titre, résumé, date, langue, durée | TMDB | — |
| Genres | TMDB | Les genres MovieLens servent seulement de vérification |
| Acteurs, réalisateurs | TMDB | — |
| **Note** | **IMDb** | La note TMDB est conservée et affichée pour comparaison |
| **Nombre de votes et progression** | **IMDb** | — |
| Popularité du jour | TMDB | — |
| Disponibilité sur les plateformes | TMDB (JustWatch) | Varie selon le pays |
| Goûts des utilisateurs | MovieLens + événements `rate` | — |

---

## 6. Harmonisation des identifiants

| Identifiant | Format attendu | Cas à corriger |
|---|---|---|
| `tmdb_id` | Entier | — |
| `imdb_id` | `tt` + au moins 7 chiffres | MovieLens fournit `1375666` → ajouter `tt` et compléter par des zéros à gauche jusqu'à 7 chiffres |
| `user_id` | Entier | Utilisateurs MovieLens : identifiants d'origine. Nouveaux inscrits (RandomUser) : à partir de 1 000 000 |

---

## 7. Licences et attributions

| Source | Conditions | Obligation dans le projet |
|---|---|---|
| TMDB | Usage non commercial, jeton personnel | Citer TMDB (« This product uses the TMDB API but is not endorsed or certified by TMDB ») |
| JustWatch (via TMDB) | Données de disponibilité | Citer JustWatch |
| IMDb | Usage personnel et non commercial | Citer IMDb ; **pas de scraping** du site |
| MovieLens | Recherche et enseignement ; **redistribution interdite** | Citer GroupLens ; ne jamais commiter les CSV |
| RandomUser | Gratuit, profils **fictifs** | Citer RandomUser ; préciser que les profils sont fictifs |
| Événements | Données **simulées** | Le préciser clairement dans le README |

**Règle générale : aucun fichier de données n'est versionné dans Git.** Le pipeline télécharge tout lui-même.

---

## 8. Hors périmètre (perspectives)

| Élément | Raison |
|---|---|
| Wikipédia (vues quotidiennes) | IMDb fournit déjà un second signal de tendance |
| Critiques TMDB | Demanderait une partie NLP |
| Autres fichiers IMDb (`title.basics`, personnes…) | Redondants avec TMDB, très volumineux |
| API FastAPI | Metabase suffit pour la démonstration |
| Portage Databricks | Après le PFE |

---

## 9. Règles du générateur d'événements

Objectif : produire des actions **réalistes**, pour que le pipeline de streaming, le score de dynamique et les tableaux de bord aient du sens.
Les pourcentages sont des valeurs de départ, **configurables**.

| # | Règle | Fonctionnement | Ce qu'elle permet de tester |
|---|---|---|---|
| R1 | **Sessions en entonnoir** | Recherche (100 %) → fiche (70 %) → bande-annonce (40 %) → ajout à la liste (20 %) → note (10 %), avec un `session_id` commun | Analyse des parcours, taux de conversion |
| R2 | **Goûts respectés** | 80 % des actions portent sur des films proches des goûts de l'utilisateur, 20 % au hasard (curiosité) | Cohérence des données comportementales |
| R3 | **Notes cohérentes** | Films correspondant aux goûts : souvent 4 à 5 ; autres films : souvent 2 à 3 ; avec une part de hasard | Réalisme des notes simulées |
| R4 | **Films « chauds »** | Les tendances TMDB du jour + quelques films poussés volontairement reçoivent beaucoup plus d'activité ; le groupe change régulièrement | **Le score de dynamique doit les détecter** |
| R5 | **Rythme de la journée** | Plus d'activité le soir et le week-end, très peu la nuit | Crédibilité des tableaux de bord |
| R6 | **Erreurs volontaires** (~2 %) | Doublons (même `event_id`), événements en retard (jusqu'à 1 h), messages mal formés (champ manquant, film inexistant) | Dédoublonnage, gestion des retards, contrôles qualité, mise à l'écart des messages invalides |

**Origine des goûts** : utilisateurs MovieLens → leurs vraies notes passées ; nouveaux inscrits → les genres préférés attribués à l'inscription.

**Règle d'or** : le moteur de recommandation n'est **jamais évalué** sur ces événements simulés (on retrouverait simplement nos propres règles). **L'évaluation se fait sur les vraies notes MovieLens.**
