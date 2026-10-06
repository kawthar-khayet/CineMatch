# Récapitulatif — Étape 1 : ingestion des données vers Bronze

## 1. En une phrase

> « J'ai construit la couche d'ingestion d'une plateforme de données de recommandation de films :
> trois sources (une API et deux jeux de fichiers) sont collectées automatiquement et stockées à l'état brut
> dans un data lake compatible S3, de façon idempotente, partitionnée par date et contrôlée en qualité dès la source. »

## 2. Ce qui a été construit

```
 API TMDB (JSON)          ──┐
 IMDb title.ratings (.gz) ──┼──► Python (requests, boto3) ──► RustFS (S3) ──► bronze/
 MovieLens (ZIP de CSV)   ──┘                                                 partitionné par date
```

| Source | Mode d'ingestion | Fréquence | Ce qu'on en tire | Stockage dans Bronze |
|---|---|---|---|---|
| **TMDB** | API REST, jeton *Bearer* | Chaque jour | Films tendance + fiches complètes (genres, durée, acteurs, réalisateurs) | `bronze/tmdb/{trending, movie_details}/ingest_date=…/` (JSON Lines) |
| **IMDb** | Téléchargement du fichier officiel | Chaque jour | Note et nombre de votes de chaque titre (~1,5 million de lignes) | `bronze/imdb/title_ratings/ingest_date=…/` (TSV compressé, tel quel) |
| **MovieLens** | Téléchargement d'une archive ZIP | Une seule fois | Notes de vrais utilisateurs (recommandation et évaluation) | `bronze/movielens/<fichier>/snapshot=<version>/` (CSV) |

**Stack** : Python 3.11, `requests`, `boto3`, Docker Compose, RustFS (stockage objet compatible S3).

Code : `data-platform/src/cinematch/` — `config.py`, `lake.py`, `ingestion/tmdb.py`, `ingestion/imdb.py`, `ingestion/movielens.py`.

## 3. Choix techniques et justifications

| Choix | Pourquoi |
|---|---|
| Architecture médaillon : Bronze brut | Garder la donnée telle que la source l'a envoyée : tout recalculer sans rappeler les API, traçabilité |
| Stockage objet via le protocole S3 | Standard des data lakes ; le même code fonctionnerait sur AWS S3 en changeant seulement l'adresse |
| Partitionnement par date (`ingest_date=AAAA-MM-JJ`) | Lecture sélective, rejeu d'un jour précis, historique ; format reconnu automatiquement par Spark |
| Partitionnement par version pour MovieLens (`snapshot=…`) | Jeu de données figé : `ml-latest-small` et `ml-32m` peuvent cohabiter |
| JSON Lines | Un objet JSON par ligne : le format que Spark lit le plus efficacement |
| Données gardées brutes (`.gz` non décompressé, JSON complet) | Bronze ne transforme rien ; Spark lit directement les fichiers compressés |
| Métadonnées préfixées par `_` (`_ingested_at`, `_page`) | Distinguer nos champs de ceux de la source ; tracer quand chaque donnée a été collectée |
| Horodatage en UTC | Une référence unique, quel que soit le fuseau horaire de la machine |
| `append_to_response=credits` | Fiche et crédits en un seul appel : deux fois moins de requêtes |
| 5 premières pages des tendances | Le signal se concentre en haut du classement ; usage raisonnable de l'API ; paramètre configurable |

## 4. Bonnes pratiques appliquées

| Pratique | Mise en œuvre |
|---|---|
| **Idempotence** | La partition du jour est vidée puis réécrite ; MovieLens n'est pas retéléchargé s'il est déjà présent (commande HEAD) |
| **Contrôle qualité à la source** | Échec si plus de 10 % des films ne sont pas récupérés ; vérification de la signature gzip du fichier IMDb |
| **Gestion des erreurs** | Un film en échec est journalisé et ignoré ; seules les erreurs HTTP sont attrapées, pas les bugs |
| **Robustesse** | `timeout` sur chaque appel ; valeurs manquantes gérées |
| **Configuration externalisée** | Variables dans `.env`, lues par `config.py`, qui échoue tôt et clairement s'il en manque une (*fail fast*) |
| **Sécurité des secrets** | `.env` ignoré par Git avant sa création ; secrets masqués à l'affichage (`repr=False`) ; jeton dans l'en-tête HTTP |
| **Découplage** | Noms génériques (`object-storage`, `S3_ACCESS_KEY`) : le code ne connaît pas l'outil de stockage réel |
| **Code réutilisable** | Fonctions séparées de leur usage ; options `--date` / `--pages` pour Airflow et le rejeu |
| **Journalisation** | `logging` horodaté avec niveaux, et un bilan chiffré à chaque exécution |
| **Licences** | Sources officielles uniquement, pas de *scraping* ; données jamais versionnées dans Git |

## 5. L'incident réel : la disparition de MinIO

> « En plein projet, l'image Docker de MinIO a été supprimée de Docker Hub, puis le registre de secours a exigé
> une authentification. J'ai évalué les alternatives (un fork communautaire, RustFS, Garage) selon des critères
> précis : image publiée, activité, licence, console web. J'ai choisi RustFS et fixé une version précise.
> Comme mon architecture reposait sur le protocole S3 et des noms génériques, le remplacement n'a demandé
> aucune modification du code, seulement la configuration Docker. »

Ce que ça montre : résolution de problème, évaluation d'outils, découplage, reproductibilité.

## 6. Chiffres à retenir

| Mesure | Valeur |
|---|---|
| Récupération d'une fiche TMDB | ~0,5 s, soit ~50 s pour 100 films |
| Taille d'une fiche TMDB brute | ~45 Ko, surtout à cause des crédits (59 acteurs pour un blockbuster) |
| Fichier IMDb | ~1,5 million de lignes chaque jour |
| MovieLens small | ~100 000 notes de 610 utilisateurs |

## 7. Questions probables en entretien

| Question | Réponse courte |
|---|---|
| Pourquoi garder les données brutes ? | Recalculer après un bug ou un nouveau besoin sans rappeler les API, garder des historiques que les sources ne fournissent pas, traçabilité. |
| C'est quoi l'idempotence, et comment l'avez-vous garantie ? | Plusieurs exécutions donnent le même résultat : remplacement de la partition du jour, vérification de l'existence des fichiers statiques. |
| Que se passe-t-il si l'API tombe ? | Une erreur passagère ne bloque qu'un film ; au-delà de 10 % d'échecs, l'ingestion échoue volontairement. |
| Pourquoi S3 ? | Standard des data lakes, code portable du local vers le cloud. |
| Pourquoi partitionner par date ? | Lecture sélective, rejeu d'un jour, historique, compatibilité native avec Spark. |
| Comment gérez-vous les secrets ? | `.env` ignoré par Git, modèle `.env.example` versionné, variables d'environnement, masquage à l'affichage. |

## 8. Ce que l'exploration des données a appris (*data discovery*)

- La liste tendance ne donne qu'un résumé (genres en codes, ni durée ni casting) : un second appel est nécessaire pour la fiche complète.
- Les films tendance sont presque tous récents, alors que MovieLens s'arrête en 2023 : d'où un moteur hybride (contenu + tendances).
- `language=en-US` ne garantit pas un titre anglais (« De Gaulle: Résistance »).
- L'API évolue : un champ `softcore` est apparu entre deux appels — un exemple réel de changement de schéma.
