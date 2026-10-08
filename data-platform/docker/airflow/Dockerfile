# Image Airflow de CineMatch : Airflow 3.3 + Java 17 (pour Spark) + nos bibliothèques + dbt (environnement séparé)
# Construite depuis la racine du projet (voir docker-compose.yml), pour utiliser le requirements.txt commun
FROM apache/airflow:3.3.2-python3.11

# --- Java 17, copié depuis l'image officielle Eclipse Temurin ---
# On copie Java au lieu de l'installer avec apt-get : ça fonctionne quelle que soit la version de Debian de l'image Airflow.
COPY --from=eclipse-temurin:17-jre /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# procps : un petit outil système dont Spark a besoin
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
USER airflow

COPY requirements.txt /tmp/requirements.txt

# --- 1. Nos bibliothèques (sans dbt), installées à côté d'Airflow ---
# On redemande la même version d'Airflow : pip ne peut alors pas la modifier en installant nos bibliothèques.
RUN grep -v "^dbt-" /tmp/requirements.txt > /tmp/requirements-airflow.txt \
    && pip install --no-cache-dir "apache-airflow==${AIRFLOW_VERSION}" -r /tmp/requirements-airflow.txt

# --- 2. dbt, dans un environnement virtuel séparé ---
# Ses dépendances entrent en conflit avec celles d'Airflow : chacun garde ses propres versions.
RUN grep "^dbt-" /tmp/requirements.txt > /tmp/requirements-dbt.txt \
    && python -m venv /home/airflow/dbt-venv \
    && /home/airflow/dbt-venv/bin/pip install --no-cache-dir -r /tmp/requirements-dbt.txt
# La commande « dbt » est trouvée partout, sans changer le Python d'Airflow (ajoutée à la FIN du PATH)
ENV PATH="${PATH}:/home/airflow/dbt-venv/bin"

# Cache des bibliothèques Java de Spark (Delta, S3A, pilote Postgres), partagé par un volume
RUN mkdir -p /home/airflow/.ivy2

# Notre code n'est pas copié dans l'image : il est partagé par un volume (voir docker-compose.yml)
ENV PYTHONPATH=/opt/airflow/src
