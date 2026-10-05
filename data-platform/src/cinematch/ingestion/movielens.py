"""Ingestion MovieLens → Bronze : notes d'utilisateurs réels (jeu de données de recherche GroupLens).

Jeu de données statique : il est téléchargé une seule fois, sauf avec --force.
Source : https://grouplens.org/datasets/movielens/ (recherche et enseignement, redistribution interdite)
Exécution : python -m cinematch.ingestion.movielens --version ml-latest-small
"""

import argparse
import io
import logging
import zipfile

import requests

from cinematch import lake

log = logging.getLogger(__name__)

BASE_URL = "https://files.grouplens.org/datasets/movielens"
FILES = ("ratings.csv", "movies.csv", "links.csv", "tags.csv")


def bronze_keys(version: str) -> dict[str, str]:
    """Chemin Bronze de chaque fichier : partitionné par version (snapshot), pas par date."""
    return {name: f"bronze/movielens/{name.removesuffix('.csv')}/snapshot={version}/{name}" for name in FILES}


def run(version: str = "ml-latest-small", force: bool = False) -> dict:
    """Télécharge l'archive MovieLens et dépose ses fichiers CSV, tels quels, dans Bronze."""
    keys = bronze_keys(version)
    if not force and all(lake.exists(key) for key in keys.values()):
        log.info("MovieLens %s déjà présent dans Bronze : rien à faire", version)
        return {"deja_present": True}

    url = f"{BASE_URL}/{version}.zip"
    log.info("Téléchargement de %s", url)
    response = requests.get(url, timeout=600)
    response.raise_for_status()

    # L'archive est ouverte en mémoire : on en extrait seulement les 4 fichiers utiles
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        for name, key in keys.items():
            lake.put_bytes(key, archive.read(f"{version}/{name}"), "text/csv")

    stats = {"version": version, "fichiers": len(keys), "archive_mo": round(len(response.content) / 1_000_000, 1)}
    log.info("Ingestion MovieLens terminée : %s", stats)
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Ingestion MovieLens vers Bronze")
    parser.add_argument("--version", default="ml-latest-small", help="ml-latest-small ou ml-32m")
    parser.add_argument("--force", action="store_true", help="retélécharger même si déjà présent")
    args = parser.parse_args()
    run(args.version, args.force)


if __name__ == "__main__":
    main()
