# Versions du projet et compatibilités

> Relevé du 2026-10-11, fait sur les environnements réels (conteneur Airflow, `package-lock.json`, Azure).
> Pour chaque version : où elle est fixée, et pourquoi elle ne peut pas être changée seule.

## 1. Les versions, par couche

### Plateforme de données (Python)

| Composant | Version | Où elle est fixée | Fixée comment |
|---|---|---|---|
| Python | 3.11 (3.11.16 dans Airflow) | Images Docker `python:3.11-slim-bookworm` et `apache/airflow:3.3.2-python3.11` | Exacte (mineure) |
| Apache Spark (PySpark) | 3.5.3 | `requirements.txt` | Exacte `==` |
| Delta Lake (`delta-spark`) | 3.2.1 | `requirements.txt` | Exacte `==` |
| Java | 17 (OpenJDK Temurin 17.0.20) | `eclipse-temurin:17-jre` (Airflow), `openjdk-17-jre-headless` (image Spark) | Majeure |
| Connecteur S3A (`hadoop-aws`) | 3.3.4 | `spark_session.py` (`EXTRA_PACKAGES`) | Exacte |
| Pilote JDBC PostgreSQL | 42.7.4 | `spark_session.py` (`EXTRA_PACKAGES`) | Exacte |
| Apache Airflow | 3.3.2 | Image `apache/airflow:3.3.2-python3.11` | Exacte |
| dbt-core | 1.12.5 | `requirements.txt` (`~=1.12.0`) | Mineure (correctifs acceptés) |
| dbt-postgres | 1.11.0 dans Airflow, 1.9.1 sur le PC | `requirements.txt` (**non fixée**) | ⚠️ voir section 4 |
| dbt_utils | 1.4.1 | `packages.yml` (`>=1.3.0,<2.0.0`), verrouillée dans `package-lock.yml` | Plage + verrou |
| numpy | 2.4.6 dans Airflow | `requirements.txt` (`>=1.26`) | Minimum |
| psycopg2 | 2.9.13 | `requirements.txt` (`>=2.9`) | Minimum |
| boto3 | 1.43 | `requirements.txt` (`>=1.34`) | Minimum |

### Stockage et bases

| Composant | Version | Où |
|---|---|---|
| RustFS (stockage objet S3) | 1.0.1 | `docker-compose.yml` |
| PostgreSQL (entrepôt local) | 16 | `docker-compose.yml` (`postgres:16`) |
| PostgreSQL (base de service Azure) | 16 (16.15) | `infra/azure/01-create-database.ps1` (`--version 16`) |
| MovieLens | `ml-latest-small` | `ingestion/movielens.py` |

### Site web

| Composant | Version | Où elle est fixée |
|---|---|---|
| Node.js | 24 (24.18 sur le PC, `node:24` pour le build, `NODE:24-lts` sur Azure) | Script 02, script 03, workflow GitHub |
| Next.js | 16.4.0 | `frontend/package.json` (exacte) |
| React / React DOM | 19.3.0 | `frontend/package.json` (exacte) |
| Tailwind CSS | 4.3.3 | `package.json` (`^4`), verrouillée dans `package-lock.json` |
| TypeScript | 5.9.3 | `package.json` (`^5`), verrouillée |
| postgres (client Node) | 3.4.9 | `package.json` (`^3.4.9`), verrouillée |
| ESLint | 9.39.5 | `package.json` (`^9`), verrouillée — ⚠️ voir section 4 |
| eslint-config-next | 16.4.0 | `package.json` (exacte, alignée sur Next.js) |

### Outils

| Outil | Version |
|---|---|
| Docker / Docker Compose | 29.4.1 / 5.1.3 |
| Azure CLI | 2.91.0 |
| ruff (lint Python) | 0.16 |

## 2. Les compatibilités à respecter

Ce sont les liens entre versions : en changer une oblige à changer les autres.

| Contrainte | Explication | Ce qui casse sinon |
|---|---|---|
| **Delta Lake 3.2.x ↔ Spark 3.5.x** | Chaque version de Delta est écrite pour une version précise de Spark (Delta 3.x → Spark 3.5, Delta 4.x → Spark 4.x) | Erreurs de classes Java au démarrage de la session |
| **`hadoop-aws` 3.3.4 ↔ Spark 3.5.3** | Spark 3.5 embarque Hadoop 3.3.4 : le connecteur S3A doit avoir exactement cette version | `ClassNotFoundException` / `NoSuchMethodError` à la première lecture `s3a://` |
| **Scala 2.12** | Les jars portent le suffixe `_2.12` (`delta-spark_2.12`) : celui de la distribution PySpark 3.5 | Jar incompatible |
| **Spark 3.5 ↔ Java 17** | Spark 3.5 accepte Java 8, 11 et 17. Java 17 est la version LTS disponible sur Debian 12 (image `bookworm`) | Spark ne démarre pas avec un Java trop récent |
| **PySpark 3.5 ↔ Python 3.11** | PySpark 3.5 prend en charge Python 3.8 à 3.11 ; les deux images Docker utilisent donc 3.11 | Erreurs à l'exécution des fonctions Python dans Spark |
| **Airflow ↔ ses dépendances** | Airflow fixe des centaines de versions. Le Dockerfile redemande `apache-airflow==${AIRFLOW_VERSION}` pour que `pip` ne puisse pas la modifier en installant nos bibliothèques | Airflow cassé par une mise à jour involontaire |
| **Airflow ↔ dbt** | Leurs dépendances sont incompatibles : dbt est installé dans un **environnement virtuel séparé** (`/home/airflow/dbt-venv`), ajouté à la fin du `PATH` | Conflit de versions à l'installation |
| **dbt-core 1.12 ↔ dbt-postgres** | Depuis dbt 1.8, l'adaptateur a sa propre numérotation : `pip` choisit une version compatible | — |
| **PostgreSQL 16 partout** | Entrepôt local et base de service Azure sur la même version majeure | Différences de comportement SQL entre les deux |
| **Node 24 partout** | Même version pour développer, construire (`node:24`) et exécuter (Azure `NODE:24-lts`). Node 22 est en fin de support sur App Service | Build non reproductible, écarts d'exécution |
| **Build Linux pour une production Linux** | `sharp` (traitement d'images de Next.js) installe un binaire par système. Un build fait sous Windows embarque `sharp-win32-x64` | Le site peut ne pas démarrer sur Azure |
| **Next.js ↔ React ↔ eslint-config-next** | Next 16 demande React 19 ; `eslint-config-next` suit la version de Next | Erreurs de build ou de lint |
| **Next.js 16 : `cacheComponents`** | `"use cache"`, `cacheLife`, `cacheTag` et `revalidateTag(tag, profil)` demandent `cacheComponents: true` | Le site ne se rafraîchit plus sans redéploiement |
| **Client `postgres` : `prepare: false`** | Nécessaire derrière un répartiteur de connexions (mode transaction) | Erreurs « prepared statement does not exist » |

## 3. Pourquoi ces versions

| Choix | Raison |
|---|---|
| Spark 3.5 plutôt que 4 | Version stable, la plus répandue en entreprise et sur Databricks au moment du projet |
| dbt 1.12 plutôt que 1.9 ou 2.0 | 1.9 affichait « deprecated » ; 2.0 (moteur Fusion) transforme en erreurs tout ce qui était obsolète. 1.12 est en support actif, et le projet est écrit sans avertissement |
| Airflow 3 plutôt que 2 | Version courante : API d'exécution des tâches, `dag-processor` séparé, notion d'*assets* |
| RustFS plutôt que MinIO | L'image MinIO a été retirée de Docker Hub ; grâce au protocole S3, le code n'a pas changé |
| Versions exactes pour Spark et Delta, plages pour le reste | Spark et Delta doivent être compatibles entre eux au correctif près ; les autres bibliothèques peuvent recevoir des correctifs |
| Node 24 LTS | LTS en support actif sur Azure App Service (Node 22 : fin de support proche) |

## 4. Points à corriger

| Constat | Risque | Action |
|---|---|---|
| `dbt-postgres` n'est pas fixé : 1.11.0 dans l'image Airflow, 1.9.1 sur le PC | Deux environnements qui ne se comportent pas pareil | Fixer la version dans `requirements.txt` (ex. `dbt-postgres~=1.11.0`) et réinstaller sur le PC |
| ESLint 9 n'est plus maintenu (avertissement à l'installation) | Aucun pour le site en ligne (outil de développement) | Passer à la version suivante en vérifiant `eslint-config-next` |
| `numpy`, `boto3`, `requests` : minimum seulement | Une future version majeure pourrait casser un build d'image | Ajouter une borne haute, ou un fichier de contraintes |
| `spark-jobs:latest`, `cinematch-airflow:latest` | Étiquette `latest` peu parlante | Étiqueter les images avec une version du projet |

## 5. Comment vérifier une version

```powershell
# Dans le conteneur Airflow (l'environnement qui exécute le pipeline)
docker compose exec airflow-scheduler python --version
docker compose exec airflow-scheduler python -c "import pyspark; print(pyspark.__version__)"
docker compose exec airflow-scheduler dbt --version
docker compose exec airflow-scheduler java -version

# Bibliothèques Java téléchargées par Spark (Delta, S3A, pilote Postgres)
docker compose exec airflow-scheduler ls /home/airflow/.ivy2/jars

# Site web
node --version
npm --prefix frontend ls next react tailwindcss

# Azure : version de Node du site, version de PostgreSQL
az webapp config show --resource-group cinematch-rg --name cinematch --query linuxFxVersion
az postgres flexible-server show --resource-group cinematch-rg --name cinematch-pg-inpt --query version
```
