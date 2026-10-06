# Récapitulatif — Étape 2, bloc A : l'infrastructure Spark (Docker, Java, Spark, S3A, Delta)

## 1. Vue d'ensemble : les 7 couches

Un traitement Spark de CineMatch traverse 7 couches, toutes réunies dans l'image Docker `cinematch-spark-jobs` :

```
┌──────────────────────────────────────────────────────────────┐
│ 7. Notre code Python          ex. spark_session.py           │
├──────────────────────────────────────────────────────────────┤
│ 6. Delta Lake                 le format de tables (registre) │
├──────────────────────────────────────────────────────────────┤
│ 5. S3A                        le connecteur vers RustFS      │
├──────────────────────────────────────────────────────────────┤
│ 4. Spark (PySpark)            le moteur de traitement        │
├──────────────────────────────────────────────────────────────┤
│ 3. Java (la JVM)              ce qui fait tourner Spark      │
├──────────────────────────────────────────────────────────────┤
│ 2. Python 3.11                                               │
├──────────────────────────────────────────────────────────────┤
│ 1. Debian 12 (Linux)          le système d'exploitation      │
└──────────────────────────────────────────────────────────────┘
```

Fichiers concernés : `data-platform/docker/spark/Dockerfile`, `requirements.txt`, `docker-compose.yml` (service `spark-jobs`),
`data-platform/src/cinematch/spark_session.py`, `data-platform/src/cinematch/transform/delta_io.py`.

## 2. Les couches, une par une

### Couche 1 — Debian : le système d'exploitation de l'image

Un conteneur Docker a son propre petit système d'exploitation, presque toujours un Linux.
**Debian** est une distribution Linux (comme Ubuntu, Fedora ou Alpine), connue pour sa stabilité.

```dockerfile
FROM python:3.11-slim-bookworm
```

| Morceau | Signification |
|---|---|
| `python:3.11` | Image officielle avec Python 3.11 déjà installé |
| `bookworm` | Debian 12 (chaque version de Debian porte un nom tiré de *Toy Story*) |
| `slim` | Version allégée : seulement l'essentiel |

Intérêt : sous Linux, installer Java se fait en une commande avec **`apt-get`**, le gestionnaire de logiciels de Debian.

### Couches 2 et 3 — Python et Java : pourquoi les deux ?

**Spark n'est pas écrit en Python** : il est écrit en Scala et tourne sur la **JVM** (la machine virtuelle de Java).
**PySpark** n'est qu'une « télécommande » en Python :

```
 Notre code Python          PySpark                    Spark (dans la JVM)
 df.write.save(...)  ───►  traduit la demande   ───►   fait le vrai travail
                           et l'envoie à Java          (lire, calculer, écrire)
```

Il faut donc Python pour notre code, **et** Java pour que Spark travaille :

```dockerfile
apt-get install -y openjdk-17-jre-headless   # Java 17 (OpenJDK), version d'exécution, sans interface graphique
ENV JAVA_HOME=/usr/lib/jvm/java-17           # indique à Spark où se trouve Java
```

### Couche 4 — Spark : le moteur

Spark répartit le travail entre plusieurs processeurs (un « chef d'équipe » et des « correcteurs »).

```python
.master("local[*]")   # Spark tourne dans le conteneur, en utilisant tous les cœurs du processeur
```

`local` : pas de cluster de plusieurs machines. `[*]` : un « correcteur » par cœur disponible.

### Couche 5 — S3A : le connecteur entre Spark et RustFS

Spark ne parle pas S3 tout seul : il lui faut un **connecteur**. **S3A** vient du projet **Hadoop** (l'ancêtre de Spark
dans le big data). Le « A » désigne la 3e génération du connecteur (`s3://`, puis `s3n://`, puis `s3a://`, la seule encore maintenue).

Quand Spark voit un chemin qui commence par **`s3a://`**, il passe la main à S3A, qui envoie les commandes S3
(PUT, GET, LIST…) à RustFS :

```
 Spark : « écris dans s3a://lakehouse/tests/delta_test »
            │
            ▼
 Connecteur S3A : traduit en commandes S3 (PUT…)
            │
            ▼
 RustFS (http://object-storage:9000)
```

S3A est l'équivalent de **boto3**, mais pour Spark. Leurs réglages se correspondent :

| Réglage S3A (`spark_session.py`) | Équivalent boto3 (`lake.py`) |
|---|---|
| `fs.s3a.endpoint` | `endpoint_url` : l'adresse de RustFS |
| `fs.s3a.access.key` / `secret.key` | Les identifiants |
| `fs.s3a.path.style.access = true` | `addressing_style = "path"` : le bucket dans le chemin |
| `fs.s3a.connection.ssl.enabled = false` | `http` et non `https`, en local |

Ce connecteur n'est pas inclus dans PySpark : c'est une bibliothèque **Java**, `hadoop-aws` :

```python
EXTRA_PACKAGES = ["org.apache.hadoop:hadoop-aws:3.3.4"]
```

### Couche 6 — Delta Lake : le format des tables

Sans Delta, une table n'est qu'un dossier de fichiers Parquet : un plantage peut laisser des fichiers abîmés,
et on ne peut pas modifier une ligne proprement. **Delta ajoute le registre `_delta_log/`**, qui dit officiellement
quels fichiers forment la table : écriture en « tout ou rien », MERGE, contrôle du schéma, historique.

Delta est fait de deux morceaux :

| Morceau | Langage | Rôle | Obtenu par |
|---|---|---|---|
| `delta-spark` | Python | La télécommande (ex. `DeltaTable.merge(...)`) | `pip install` (`requirements.txt`) |
| Le cœur de Delta | Java | Le vrai travail : registre, MERGE | Ajouté automatiquement par `configure_spark_with_delta_pip` |

Deux lignes l'activent dans Spark (comme on branche un module) :

```python
.config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
.config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
```

Les deux façons d'écrire une table Delta (`transform/delta_io.py`) :

| Fonction | Rôle | Utilisée pour |
|---|---|---|
| `upsert_delta` | MERGE : met à jour les lignes existantes (même clé), insère les nouvelles, crée la table si besoin | TMDB, IMDb : données qui arrivent chaque jour (incrémental) |
| `overwrite_delta` | Remplace toute la table | MovieLens : jeu de données figé |

### Couche 7 — Notre code : le test de bout en bout

```python
movies = spark.createDataFrame([(27205, "Inception", 148), ...])  # une mini-table de 2 films
movies.write.format("delta").mode("overwrite").save(path)        # l'écrire en Delta dans RustFS
spark.read.format("delta").load(path).show()                     # la relire et l'afficher
```

Ce test traverse toutes les couches : si les deux films s'affichent, tout fonctionne, de Debian jusqu'à Delta.

## 3. L'enchaînement complet

### `docker compose build spark-jobs` (une seule fois)

```
1. Docker lit docker-compose.yml → service spark-jobs → construire l'image
2. Il envoie le contexte (la racine du projet, SANS ce qu'exclut .dockerignore : .env, .venv…)
3. Il suit le Dockerfile, ligne par ligne :
   a. télécharge l'image de base : Debian 12 + Python 3.11        (couches 1 et 2)
   b. apt-get install Java 17                                     (couche 3)
   c. pip install -r requirements.txt : pyspark, delta-spark…     (couche 4 + partie Python de Delta)
4. Résultat : l'image « cinematch-spark-jobs », stockée sur le PC
```

### `docker compose run --rm spark-jobs python -m cinematch.spark_session`

```
1. Docker vérifie que object-storage (RustFS) tourne                (depends_on)
2. Il crée un conteneur à partir de l'image, avec :
   • les variables de .env, et S3_ENDPOINT=http://object-storage:9000
   • le code, partagé dans /app/src                                 (volume)
   • le cache des bibliothèques Java                                (volume spark-ivy-cache)
3. Dans le conteneur, Python lance le module spark_session :
   a. get_settings() lit les variables
   b. get_spark() démarre Spark :
      → Java démarre
      → la 1re fois : l'outil « Ivy » TÉLÉCHARGE les bibliothèques Java
        de Delta et de S3A (~300 Mo) et les range dans le cache
      → Delta et S3A sont branchés
   c. le test crée 2 lignes, puis les écrit :
      Spark → Delta (fichiers Parquet + registre) → S3A (commandes S3) → RustFS
   d. le test relit la table et l'affiche
4. Le programme se termine → --rm supprime le conteneur
   (les données restent dans RustFS, le cache dans son volume)
```

| Morceau de la commande | Signification |
|---|---|
| `run` | Lance une seule fois une commande dans un nouveau conteneur |
| `--rm` | Supprime le conteneur à la fin |
| `spark-jobs` | Le service à utiliser |
| `python -m cinematch.spark_session` | La commande exécutée dans le conteneur |

### Ce qu'il y a ensuite dans RustFS

```
lakehouse/tests/delta_test/
├── part-00000-….snappy.parquet   ← les données (Parquet, compressé avec « snappy »)
├── part-00001-….snappy.parquet
└── _delta_log/
    └── 00000000000000000000.json ← le registre : « version 0 = ces fichiers Parquet »
```

## 4. Points de configuration à retenir

| Élément | Où | Pourquoi |
|---|---|---|
| `S3_ENDPOINT: http://object-storage:9000` | `docker-compose.yml` | Dans un conteneur, `localhost` désigne le conteneur lui-même : on joint RustFS par le nom de son service |
| Code partagé par un volume (`./data-platform/src:/app/src`) | `docker-compose.yml` | Une modification du code est vue tout de suite, sans reconstruire l'image |
| Volume `spark-ivy-cache` | `docker-compose.yml` | Les ~300 Mo de bibliothèques Java ne sont téléchargés qu'une fois |
| `profiles: ["jobs"]` | `docker-compose.yml` | Le service ne démarre qu'à la demande |
| Contexte de construction = racine + `.dockerignore` | `docker-compose.yml`, `.dockerignore` | Utiliser le `requirements.txt` commun sans envoyer `.env` ni `.venv` à Docker |
| `pyspark==3.5.3` et `delta-spark==3.2.1` | `requirements.txt` | Versions exactes : Delta 3.2 correspond à Spark 3.5 |

## 5. À retenir

> **Debian** = le Linux dans le conteneur, où installer Java est facile. **Java** = ce qui fait tourner Spark
> (PySpark n'est qu'une télécommande Python). **S3A** = le connecteur qui permet à Spark de parler S3, donc à RustFS
> (l'équivalent de boto3 pour Spark). **Delta** = le registre qui rend les tables fiables. L'**image Docker** empile tout ça,
> une fois pour toutes.

## 6. Pour un entretien

> « J'ai conteneurisé mes traitements Spark dans une image Debian avec Java 17, PySpark et Delta Lake.
> Spark accède au data lake S3 par le connecteur S3A d'Hadoop, et les tables Silver sont écrites au format Delta
> pour avoir des écritures transactionnelles et des MERGE incrémentaux. »
