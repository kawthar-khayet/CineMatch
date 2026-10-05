"""Ingestion IMDb → Bronze : le fichier officiel des notes (title.ratings), republié chaque jour par IMDb.

Source : https://datasets.imdbws.com/ (usage personnel et non commercial)
Exécution : python -m cinematch.ingestion.imdb --date 2026-10-05
"""

import argparse
import datetime
import logging

import requests

from cinematch import lake

log = logging.getLogger(__name__)

RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
GZIP_SIGNATURE = b"\x1f\x8b"  # les 2 premiers octets de tout fichier .gz


def run(ingest_date: str) -> dict:
    """Télécharge le fichier des notes IMDb du jour et le dépose tel quel (compressé) dans Bronze."""
    response = requests.get(RATINGS_URL, timeout=120)
    response.raise_for_status()

    # Contrôle qualité à la source : on vérifie qu'on a bien reçu un fichier compressé, pas une page d'erreur
    if not response.content.startswith(GZIP_SIGNATURE):
        raise RuntimeError("Le fichier IMDb reçu n'est pas un fichier .gz valide")

    key = lake.bronze_key("imdb", "title_ratings", ingest_date, "title.ratings.tsv.gz")
    lake.put_bytes(key, response.content, "application/gzip")

    stats = {
        "taille_mo": round(len(response.content) / 1_000_000, 1),
        "publie_par_imdb_le": response.headers.get("Last-Modified"),
    }
    log.info("Ingestion IMDb du %s terminée : %s", ingest_date, stats)
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Ingestion IMDb vers Bronze")
    parser.add_argument("--date", default=datetime.datetime.now(tz=datetime.UTC).date().isoformat(), help="date d'ingestion (AAAA-MM-JJ)")
    run(parser.parse_args().date)


if __name__ == "__main__":
    main()
