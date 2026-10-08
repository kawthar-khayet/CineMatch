"""Ingestion IMDb → Bronze : les fichiers officiels d'IMDb, republiés chaque jour.

  title.ratings : note et nombre de votes de chaque titre
  title.basics  : type de contenu (film, série, épisode…), titre, année, durée, genres

Source : https://datasets.imdbws.com/ (usage personnel et non commercial)
Exécution : python -m cinematch.ingestion.imdb --date 2026-10-05
"""

import argparse
import datetime
import logging

import requests

from cinematch import lake

log = logging.getLogger(__name__)

BASE_URL = "https://datasets.imdbws.com"
DATASETS = {
    "title_ratings": "title.ratings.tsv.gz",
    "title_basics": "title.basics.tsv.gz",
}
GZIP_SIGNATURE = b"\x1f\x8b"  # les 2 premiers octets de tout fichier .gz


def ingest_file(dataset: str, filename: str, ingest_date: str) -> dict:
    """Télécharge un fichier IMDb et le dépose tel quel (compressé) dans Bronze."""
    response = requests.get(f"{BASE_URL}/{filename}", timeout=600)
    response.raise_for_status()

    # Contrôle qualité à la source : on vérifie qu'on a bien reçu un fichier compressé, pas une page d'erreur
    if not response.content.startswith(GZIP_SIGNATURE):
        raise RuntimeError(f"Le fichier IMDb {filename} reçu n'est pas un fichier .gz valide")

    key = lake.bronze_key("imdb", dataset, ingest_date, filename)
    lake.put_bytes(key, response.content, "application/gzip")
    return {
        "taille_mo": round(len(response.content) / 1_000_000, 1),
        "publie_par_imdb_le": response.headers.get("Last-Modified"),
    }


def run(ingest_date: str) -> dict:
    """Ingère tous les fichiers IMDb du jour dans Bronze."""
    stats = {dataset: ingest_file(dataset, filename, ingest_date) for dataset, filename in DATASETS.items()}
    log.info("Ingestion IMDb du %s terminée : %s", ingest_date, stats)
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Ingestion IMDb vers Bronze")
    parser.add_argument(
        "--date",
        default=datetime.datetime.now(tz=datetime.UTC).date().isoformat(),
        help="date d'ingestion (AAAA-MM-JJ)",
    )
    run(parser.parse_args().date)


if __name__ == "__main__":
    main()
