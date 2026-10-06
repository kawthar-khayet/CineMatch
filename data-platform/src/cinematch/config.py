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
    postgres_host: str
    postgres_port: int
    postgres_db: str
    postgres_user: str
    tmdb_api_token: str = field(repr=False)
    s3_access_key: str = field(repr=False)
    s3_secret_key: str = field(repr=False)
    postgres_password: str = field(repr=False)

    @property
    def jdbc_url(self) -> str:
        """Adresse de Postgres au format JDBC, utilisé par Spark (Java)."""
        return f"jdbc:postgresql://{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"


def get_settings() -> Settings:
    """Construit la configuration à partir des variables d'environnement."""
    return Settings(
        s3_endpoint=_require("S3_ENDPOINT"),
        lakehouse_bucket=_require("LAKEHOUSE_BUCKET"),
        postgres_host=_require("POSTGRES_HOST"),
        postgres_port=int(_require("POSTGRES_PORT")),
        postgres_db=_require("POSTGRES_DB"),
        postgres_user=_require("POSTGRES_USER"),
        tmdb_api_token=_require("TMDB_API_TOKEN"),
        s3_access_key=_require("S3_ACCESS_KEY"),
        s3_secret_key=_require("S3_SECRET_KEY"),
        postgres_password=_require("POSTGRES_PASSWORD"),
    )


if __name__ == "__main__":
    print(get_settings())
