"""Connexion à l'entrepôt Postgres (schémas silver, staging, marts), avec les réglages du .env."""

import psycopg2

from cinematch.config import get_settings


def connect_warehouse():
    """Connexion psycopg2 à l'entrepôt : localhost:5433 depuis le PC, postgres:5432 depuis un conteneur."""
    settings = get_settings()
    return psycopg2.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        dbname=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
    )
