# Image des traitements Spark de CineMatch : Python 3.11 + Java 17 + Spark 3.5 + Delta Lake
# Construite depuis la racine du projet (voir docker-compose.yml), pour utiliser le requirements.txt commun
FROM python:3.11-slim-bookworm

# Spark tourne sur la machine virtuelle Java (JVM)
RUN apt-get update \
    && apt-get install -y --no-install-recommends openjdk-17-jre-headless procps \
    && ln -s "/usr/lib/jvm/java-17-openjdk-$(dpkg --print-architecture)" /usr/lib/jvm/java-17 \
    && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Le code n'est pas copié dans l'image : il est partagé avec le conteneur (volume dans docker-compose.yml)
ENV PYTHONPATH=/app/src
