"""Configuration du projet : lit les variables d'environnement (fichier .env) en un seul endroit."""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

# Lit le fichier .env et ajoute ses variables à l'environnement
load_dotenv()


def _require(name: str) -> str:
    """Renvoie la valeur d'une variable obligatoire, ou s'arrête avec un message clair."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Variable manquante dans .env : {name}")
    return value


@dataclass(frozen=True)
class Settings:
    """Les réglages du projet. Les secrets sont masqués à l'affichage (repr=False)."""

    s3_endpoint: str
    lakehouse_bucket: str
    tmdb_api_token: str = field(repr=False)
    s3_access_key: str = field(repr=False)
    s3_secret_key: str = field(repr=False)


def get_settings() -> Settings:
    """Construit la configuration à partir des variables d'environnement."""
    return Settings(
        s3_endpoint=_require("S3_ENDPOINT"),
        lakehouse_bucket=_require("LAKEHOUSE_BUCKET"),
        tmdb_api_token=_require("TMDB_API_TOKEN"),
        s3_access_key=_require("S3_ACCESS_KEY"),
        s3_secret_key=_require("S3_SECRET_KEY"),
    )


if __name__ == "__main__":
    print(get_settings())
