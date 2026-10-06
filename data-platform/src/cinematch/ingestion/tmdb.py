"""Ingestion TMDB → Bronze : films tendance du jour et leurs fiches complètes (avec crédits).

Exécution : python -m cinematch.ingestion.tmdb --date 2026-10-05 --pages 5
"""

import argparse
import logging
from datetime import UTC, datetime

import requests

from cinematch import lake
from cinematch.config import get_settings

log = logging.getLogger(__name__)

BASE_URL = "https://api.themoviedb.org/3"
CHUNK_SIZE = 100  # nombre de fiches par fichier Bronze
MAX_FAILURE_RATE = 0.10  # au-delà de 10 % d'échecs, l'ingestion échoue


def _get(path: str, params: dict | None = None) -> dict:
    """Envoie une requête GET à l'API TMDB et renvoie la réponse JSON."""
    response = requests.get(
        f"{BASE_URL}{path}",
        headers={
            "Authorization": f"Bearer {get_settings().tmdb_api_token}",
            "accept": "application/json",
        },
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def fetch_trending(page: int = 1) -> dict:
    """Renvoie une page des films tendance du jour (réponse JSON complète)."""
    return _get("/trending/movie/day", {"page": page, "language": "en-US"})


def fetch_movie_details(movie_id: int) -> dict:
    """Renvoie la fiche complète d'un film, crédits inclus (réponse JSON complète)."""
    return _get(f"/movie/{movie_id}", {"append_to_response": "credits", "language": "en-US"})


def run(ingest_date: str, pages: int = 5) -> dict:
    """Ingère les films tendance et leurs fiches complètes dans Bronze, pour une date donnée."""
    ingested_at = datetime.now(UTC).isoformat()

    # Idempotence : on vide la partition du jour avant de la réécrire
    for dataset in ("trending", "movie_details"):
        lake.delete_prefix(f"bronze/tmdb/{dataset}/ingest_date={ingest_date}/")

    # 1. Les pages de la liste tendance, telles que l'API les renvoie
    trending_pages = []
    for page in range(1, pages + 1):
        response = fetch_trending(page)
        response["_page"] = page
        response["_ingested_at"] = ingested_at
        trending_pages.append(response)
    lake.put_jsonl(lake.bronze_key("tmdb", "trending", ingest_date, "pages.jsonl"), trending_pages)

    # 2. La fiche complète de chaque film (sans doublon), par paquets de CHUNK_SIZE
    movie_ids = list(dict.fromkeys(movie["id"] for page in trending_pages for movie in page["results"]))
    details, failed = [], []
    for movie_id in movie_ids:
        try:
            movie = fetch_movie_details(movie_id)
        except requests.HTTPError as error:
            failed.append(movie_id)
            log.warning("Film %s ignoré : %s", movie_id, error)
            continue
        movie["_ingested_at"] = ingested_at
        details.append(movie)

    for number, start in enumerate(range(0, len(details), CHUNK_SIZE), start=1):
        key = lake.bronze_key("tmdb", "movie_details", ingest_date, f"part-{number:04d}.jsonl")
        lake.put_jsonl(key, details[start : start + CHUNK_SIZE])

    stats = {"pages": len(trending_pages), "films": len(movie_ids), "fiches": len(details), "echecs": len(failed)}
    log.info("Ingestion TMDB du %s terminée : %s", ingest_date, stats)

    # Contrôle qualité à la source : trop d'échecs = on arrête plutôt que de livrer des données incomplètes
    if movie_ids and len(failed) / len(movie_ids) > MAX_FAILURE_RATE:
        raise RuntimeError(f"Taux d'échec trop élevé : {len(failed)}/{len(movie_ids)} films")
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Ingestion TMDB vers Bronze")
    parser.add_argument(
        "--date", default=datetime.now(UTC).date().isoformat(), help="date d'ingestion (AAAA-MM-JJ, UTC)"
    )
    parser.add_argument("--pages", type=int, default=5, help="nombre de pages de la liste tendance")
    args = parser.parse_args()
    run(args.date, args.pages)


if __name__ == "__main__":
    main()
