# Récapitulatif — Étape 5 : couche de service, site web, recommandation et déploiement Azure

## 1. En une phrase

> « J'ai mis le produit en ligne : Airflow publie chaque jour la couche Gold dans une base de service sur Azure,
> un site Next.js la lit et se rafraîchit tout seul, et un moteur de recommandation hybride et explicable propose
> des films à une personne ou à un groupe. Le site ne contient aucune logique métier : tout est calculé en amont
> par le pipeline. »

Site en ligne : https://cinematch.azurewebsites.net

## 2. Ce qui a été construit

```
 PC (Docker)                                                Azure (Spain Central)
 ───────────                                                ─────────────────────
 Airflow, chaque jour à 6 h UTC
 ingestion → Spark → dbt (Gold) ─► publish_serving ──────►  PostgreSQL « cinematch_serving »   ◄── lit ──  App Service
        (10e et 11e tâches du DAG)       │                  schéma serving : movies,                       site Next.js
                                         │                  reco_movies, pipeline_stats                    (Node 24, B1)
                                         └── POST /api/revalidate (secret partagé) ───────────────────────►  rafraîchit
                                                                                                             son cache
```

| Bloc | Contenu | Fichiers principaux |
|---|---|---|
| A | Couche de service : Gold → base hébergée | `src/cinematch/serving/site_data.py`, `publish.py`, `warehouse.py` |
| B | Site web (3 pages + fiche film) | `frontend/src/app/`, `frontend/src/lib/queries.ts` |
| C | Recommandation : fiches TMDB du catalogue, caractéristiques, collaboratif, moteur | `ingestion/tmdb_catalog.py`, `mart_movie_features.sql`, `recommendation/collaborative.py`, `frontend/src/lib/recommend.ts` |
| D | Déploiement Azure reproductible | `infra/azure/01-…`, `02-…`, `03-….ps1`, `.github/workflows/deploy-site.yml` |

Le DAG `cinematch_batch_daily` passe de 9 à **11 tâches** (`ingest_tmdb_catalog`, `publish_serving`),
et dbt de 74 à **81 modèles et tests**.

## 3. Bloc A — La couche de service

### Pourquoi une base séparée ?

| Entrepôt (Postgres local) | Base de service (Azure) |
|---|---|
| Tout le modèle : silver, staging, marts | Seulement ce que le site affiche |
| Écrit par Spark et dbt, lu par l'analyse | Écrit par une tâche Airflow, lu par le site |
| Sur le PC, pas exposé à Internet | En ligne, exposé au site |

C'est le principe de la **couche de service** (*serving layer*) : le site ne se connecte jamais à l'entrepôt.
On peut reconstruire l'entrepôt sans toucher au site, et une panne du pipeline ne coupe pas le site :
il continue d'afficher la dernière publication.

### Ce que fait `publish_serving`

1. `site_data.build()` lit `marts.mart_hype_or_gem` et les chiffres clés.
2. Chaque film est complété par sa fiche TMDB en anglais (affiche, résumé, genres, réalisateur, acteurs) :
   c'est de la **présentation**, les classements et explications viennent de Gold.
3. `build_reco_catalog()` lit `marts.mart_movie_features` et calcule les voisins collaboratifs.
4. `publish.write()` remplace le contenu de `serving.movies`, `serving.reco_movies` et `serving.pipeline_stats`
   **en une seule transaction** : le site ne voit jamais une table à moitié remplie.
5. `notify_site()` appelle `POST /api/revalidate` avec un secret : le site rafraîchit son cache tout de suite.

Les tables sont créées par la tâche (`create … if not exists`) : elle fonctionne sur une base vide.

### Le titre affiché (règle du site)

| Cas | Exemple |
|---|---|
| Film en anglais | `Spider-Man: Brand New Day` |
| Film étranger : titre original + traduction anglaise | `ルックバック (Look Back)`, `Le Trou (The Hole)` |
| Original et anglais identiques | `Jean de Florette` |
| TMDB sans titre anglais (13 films) | Titre anglais repris de MovieLens et remis en forme : « Trou, Le (Hole, The) » → « The Hole » |

Les explications de l'indice (« #1 trending, and well rated: 8.0/10 on IMDb ») sont générées **par dbt**,
dans `mart_hype_or_gem.sql` : elles ont été traduites là, pas dans le site.

## 4. Bloc B — Le site web

| Page | Contenu |
|---|---|
| `/` | Accroche, date des tendances, chiffres clés, trois rangées de films (vraies tendances, pépites, buzz trompeurs) |
| `/hype-check` | Les films classés : filtre par catégorie, recherche (titre, genre, réalisateur, acteur), tri |
| `/film/[id]` | Fiche : verdict et explication, note et votes IMDb, rang tendance, résumé, équipe |
| `/recommend` | Recommandation pour une personne ou un groupe |
| `/api/revalidate` | Appelée par Airflow : rafraîchit le cache (protégée par un secret) |
| `/api/reco-catalog` | Catalogue de recommandation, chargé une fois par le navigateur |

### Comment le site reste à jour sans redéploiement

- `lib/queries.ts` lit la base avec `"use cache"` : le résultat est gardé **une heure** (`cacheLife("hours")`)
  et étiqueté `serving` (`cacheTag`).
- Quand Airflow a publié, il appelle `/api/revalidate`, qui exécute `revalidateTag("serving", { expire: 0 })` :
  la visite suivante lit les nouvelles données.
- Sans cet appel (PC éteint, réseau coupé), le site se rafraîchit de lui-même au bout d'une heure.

Les pages sont **pré-générées au build** (241 pages, dont une par film) : c'est pour cela que le build a besoin
de l'adresse de la base.

### Un site « produit », sans jargon

Le site est destiné à un visiteur, pas à un recruteur technique : aucune mention du pipeline, des outils ni du projet
d'études. La preuve technique est dans le dépôt GitHub. Restent seulement les crédits obligatoires
(TMDB, IMDb, MovieLens) en pied de page.

## 5. Bloc C — La recommandation

### C1. Combler une limite : les fiches TMDB du catalogue

Avant, seuls les ~95 films tendance avaient des acteurs et des réalisateurs. `ingest_tmdb_catalog` récupère la fiche
TMDB des films MovieLens notés **au moins 10 fois** (2 269 films).

| Choix | Pourquoi |
|---|---|
| Seuil de 10 notes | Un film noté par 3 personnes ne peut pas être recommandé sérieusement |
| **Incrémental** : les films déjà dans `silver.tmdb_movies` ne sont pas redemandés | Premier passage : 2 264 fiches en 5 min. Ensuite : presque rien |
| 8 requêtes en parallèle | L'API TMDB accepte une cinquantaine de requêtes par seconde |
| Même format que les fiches tendance | `silver_tmdb` lit les deux dossiers ensemble, sans code supplémentaire |

### C2. `mart_movie_features` (dbt)

1 ligne par film recommandable : genres, réalisateurs, 5 acteurs principaux (`array_agg` sur les tables de pont),
durée, notes IMDb, popularité MovieLens. **2 348 films**, avec tests (unicité, relation vers `dim_movie`).

### C3. Le filtrage collaboratif (`collaborative.py`)

« Les films aimés par les mêmes spectateurs se ressemblent. »

1. Matrice films × utilisateurs à partir de 81 021 notes MovieLens.
2. **Notes centrées** : on retire la moyenne de chaque utilisateur (certains notent sévèrement, d'autres non).
3. **Similarité cosinus** entre toutes les paires de films, en une multiplication de matrices (numpy).
4. **Shrinkage** : la similarité est multipliée par `n / (n + 10)`, où `n` est le nombre de spectateurs communs.
   Une ressemblance vue sur 3 personnes compte moins que sur 50.
5. On garde les 20 voisins de chaque film. Exemple : *Inception* → *The Dark Knight*, *The Departed*.

### C4. Le moteur (`recommend.ts`, dans le navigateur)

Score d'un film pour une personne :

| Part | Poids | Calcul |
|---|---|---|
| Contenu | 40 % | Genres (50 %), réalisateur (30 %), acteurs (20 %) en commun avec ses goûts |
| Collaboratif | 40 % | Similarité avec le film aimé le plus proche |
| Qualité | 20 % | Note IMDb, de 5/10 (0) à 9/10 (1) |

- Les goûts viennent des **films aimés** et des **genres, réalisateurs, acteurs choisis directement**.
- Sans aucun film aimé, la part collaborative est reportée sur le contenu (elle a besoin de films).
- **Contraintes du soir** : durée maximale (filtre), genres souhaités (bonus).
- **Groupe** : chaque membre est noté séparément, son score est ramené à son meilleur score (tout le monde pèse
  pareil), puis on combine : **moyenne** ou **moindre déception** (le minimum : personne n'est laissé de côté).
- **Chaque recommandation est expliquée**, par membre : « Directed by Christopher Nolan, like The Dark Knight ».

Pourquoi dans le navigateur ? Le catalogue (2 348 films, ~1,3 Mo) est chargé une fois ; chaque clic recalcule
instantanément, sans aller-retour avec un serveur. Le calcul lourd (similarités) reste dans le pipeline.

## 6. Bloc D — Le déploiement Azure

| Ressource | Nom | Réglages |
|---|---|---|
| Groupe de ressources | `cinematch-rg` | Région `spaincentral` |
| Azure Database for PostgreSQL | `cinematch-pg-inpt` | Flexible Server, B1ms, 32 Go, PostgreSQL 16, base `cinematch_serving` |
| Plan App Service | `cinematch-plan` | Linux, **B1** |
| App Service | `cinematch` | Node 24 LTS, démarrage `node server.js`, Always On, HTTPS obligatoire |

### Les choix

| Choix | Pourquoi |
|---|---|
| Région Espagne | L'abonnement étudiant n'autorise que 5 régions (stratégie « Allowed resource deployment regions ») ; c'est la plus proche du Maroc, et elle propose les deux services |
| Niveau **B1** et non F1 (gratuit) | F1 « endort » le site : 10 à 30 s d'attente au premier visiteur. B1 permet **Always On** |
| Build **autonome** (`output: "standalone"`) | Un serveur Node complet dans un dossier : rien à installer sur Azure |
| Build **dans un conteneur Linux** | Un build fait sous Windows embarque `sharp-win32`, inutilisable sur les serveurs Linux d'Azure |
| Base ouverte à toutes les adresses IP | Le site (Azure) et le pipeline (PC, adresse IP variable) s'y connectent. Protection : mot de passe de 32 caractères + TLS obligatoire. Acceptable car données publiques seulement |
| Scripts PowerShell dans `infra/azure/` | Infrastructure reproductible et documentée ; les secrets sont générés et rangés dans `.env`, jamais affichés |
| `HOSTNAME=0.0.0.0` | Le serveur Next.js autonome écoute sur `HOSTNAME` ; dans un conteneur, il doit écouter sur toutes les interfaces |

### Coût

Environ **13 $ par mois** (App Service B1), pris sur le crédit Azure for Students (100 $, valable jusqu'au 10/10/2027).
PostgreSQL B1ms fait partie des services gratuits 12 mois ; **à confirmer** sur la page Education du portail
(si la base est facturée : ~16 $ de plus par mois).

## 7. Les problèmes rencontrés

| Problème | Cause | Résolution |
|---|---|---|
| Le DAG échoue les 9 et 10 octobre sur `ingest_tmdb_catalog` : « Taux d'échec trop élevé : 5/5 » | 5 films MovieLens n'existent plus sur TMDB (404). Ingestion incrémentale : dès le 2e jour, on ne redemande qu'eux → 100 % d'échecs | Distinguer **absent de TMDB** (404, pas une panne) et **échec** (réseau, serveur). Le contrôle qualité ne compte que les pannes |
| Titres en japonais ou tamoul sur le site | Sans traduction, TMDB renvoie le titre original | Règle « original (anglais) », avec repli sur le titre MovieLens |
| `MissingSubscriptionRegistration` à la création de la base | Sur un abonnement neuf, chaque service Azure doit être activé une fois | `az provider register --namespace Microsoft.DBforPostgreSQL` |
| Script arrêté après la création du serveur : mot de passe perdu | Mauvaise option (`--database-name` au lieu de `--name`) | Script rendu **relançable** : si le serveur existe, il change seulement son mot de passe |
| Accents illisibles (« Ã© ») dans les scripts | Windows PowerShell 5.1 lit un fichier UTF-8 sans BOM comme de l'ANSI | Scripts enregistrés en UTF-8 **avec BOM** |
| Guillemets supprimés dans une commande passée à Docker | Windows PowerShell retire les guillemets doubles imbriqués des arguments | Commande réécrite sans guillemets (`python3 -m zipfile`) |
| « DEPLOYMENT FAILED » alors que le site fonctionne | Au premier déploiement, Azure lance le site avant l'arrivée des fichiers, puis abandonne le suivi | `--track-status false`, et le script vérifie lui-même que le site répond |
| Le site local « ne marche pas » | Le serveur de test avait été arrêté ; ou Docker éteint (le site lit Postgres) | Relancer le serveur ; Docker allumé |
| `new Date()` dans le pied de page | Avec le cache de composants, lire l'heure pendant le pré-rendu est interdit | Année écrite en dur |
| `az` introuvable après installation | Le terminal ouvert avant l'installation ne connaît pas le nouveau `PATH` | Fermer et rouvrir le terminal |
| Erreur AADSTS50020 à la connexion Azure | Lien de l'e-mail pointant vers le répertoire « Microsoft » | Ouvrir `portal.azure.com/<mon-répertoire>.onmicrosoft.com` |

## 8. Commandes utiles

```powershell
# Site en local (Docker démarré ; frontend/.env.local pointe vers la base de service)
npm --prefix frontend run dev -- -p 3001

# Publier maintenant dans la base de service et prévenir le site (ce que fait la tâche publish_serving)
docker compose exec airflow-scheduler python -m cinematch.serving.publish

# Azure : créer la base, créer le site, déployer (dans cet ordre, une seule fois pour 01 et 02)
.\infra\azure\01-create-database.ps1
.\infra\azure\02-create-site.ps1
.\infra\azure\03-deploy-site.ps1          # à relancer après chaque modification du site

# Azure : journaux du site, et retour au niveau gratuit pour économiser le crédit
az webapp log tail --resource-group cinematch-rg --name cinematch
az appservice plan update --resource-group cinematch-rg --name cinematch-plan --sku F1

# Tout supprimer (arrête tous les coûts)
az group delete --name cinematch-rg
```

Après un changement de `.env`, `docker compose up -d` recrée les conteneurs Airflow pour qu'ils lisent les nouvelles valeurs.

## 9. Questions probables en entretien

| Question | Réponse courte |
|---|---|
| Pourquoi une base de service séparée de l'entrepôt ? | Pour découpler : le site ne voit que ce qu'il affiche, l'entrepôt n'est pas exposé, et une panne du pipeline ne coupe pas le site. |
| Comment le site se met-il à jour ? | La dernière tâche du DAG écrit la base de service en une transaction, puis appelle une route protégée qui invalide le cache. Sans cet appel, le cache expire en une heure. |
| Pourquoi une seule transaction ? | Pour que le site ne lise jamais un état partiel entre le `delete` et l'`insert`. |
| Où est la logique métier ? | Dans Gold : le classement et son explication viennent d'un modèle dbt testé. Le site affiche. |
| Contenu ou collaboratif ? | Les deux : le contenu fonctionne pour un film récent sans notes (démarrage à froid), le collaboratif capte des goûts que les genres ne décrivent pas. |
| Qu'est-ce que le shrinkage ? | Une pondération par le nombre de spectateurs communs : elle évite de croire une similarité calculée sur 2 ou 3 personnes. |
| Comment recommander pour un groupe ? | Un score par membre, normalisé, puis une stratégie : moyenne, ou moindre déception (le minimum) pour ne laisser personne de côté. |
| Comment avez-vous évalué la recommandation ? | Pas encore : les poids 40/40/20 sont une première version. Prochaine étape : évaluation hors ligne sur des notes MovieLens mises de côté (précision@10). |
| Pourquoi le build dans un conteneur Linux ? | Les dépendances natives (sharp) sont propres au système : il faut construire sur le même système que la production. |
| Pourquoi la tâche a-t-elle échoué en production ? | Mon contrôle qualité comptait les films supprimés de TMDB comme des pannes ; avec l'incrémental, ils représentaient 100 % des demandes. J'ai séparé « absent » et « échec ». |
| La base est ouverte à Internet : est-ce sûr ? | Compromis assumé : données publiques, mot de passe long, TLS. Pour des données sensibles : réseau privé ou liste d'adresses autorisées. |
| Que se passe-t-il si votre PC est éteint ? | Le site reste en ligne avec la dernière publication. Prochaine étape : une machine Azure allumée une heure par jour pour le pipeline. |

## 10. Pour un entretien

> « Le site est la partie visible : il lit une base de service sur Azure, que la dernière tâche de mon DAG Airflow
> remplit chaque jour en une transaction, avant de prévenir le site pour qu'il rafraîchisse son cache.
> La recommandation est hybride : des caractéristiques de films construites avec dbt, et un filtrage collaboratif
> calculé sur les notes MovieLens. Chaque suggestion est expliquée, y compris pour un groupe.
> En production, une tâche a échoué deux jours de suite : mon contrôle qualité confondait les films supprimés
> de TMDB avec des pannes. Je l'ai corrigé en distinguant les deux cas. »

## 11. Les limites connues et la suite

| Limite | Piste |
|---|---|
| Le pipeline tourne sur le PC : pas de mise à jour si Docker est éteint à 6 h UTC | Machine virtuelle Azure allumée 1 h par jour (~8 $/mois) |
| Recommandation non évaluée, poids choisis à la main | Évaluation hors ligne (`src/cinematch/evaluation/`) |
| 2 348 films recommandables sur 9 828 | Baisser le seuil, ou MovieLens 32M |
| Déploiement du site lancé depuis le PC | Activer le workflow GitHub Actions (variable `AZURE_WEBAPP_NAME` et deux secrets) |
| ESLint 9 n'est plus maintenu | Passer à la version suivante, en vérifiant `eslint-config-next` |
| Données IMDb et MovieLens : usage non commercial | Projet d'études et portfolio uniquement |
