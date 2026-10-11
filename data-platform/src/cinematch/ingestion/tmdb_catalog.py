"""Ingestion TMDB → Bronze : fiches complètes (avec crédits) des films du catalogue MovieLens.

Sans elles, les films MovieLens n'ont ni acteurs, ni réalisateurs, ni durée : la recommandation par le contenu
serait impossible. On ne prend que les films assez notés pour être recommandés (MIN_RATINGS notes ou plus).

Incrémental : les films déjà présents dans Silver (silver.tmdb_movies, publié dans Postgres) ne sont pas
redemandés. Le premier passage récupère ~2 300 fiches (quelques minutes) ; les suivants, presque rien.
Les fiches ont le même format que celles de l'ingestion tendance : silver_tmdb les traite de la même façon.

Exécution : python -m cinematch.ingestion.tmdb_catalog --date 2026-10-08
"""

import argparse
import csv
import io
import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import psycopg2
import requests

from cinematch import lake
from cinematch.ingestion.movielens import bronze_keys
from cinematch.ingestion.tmdb import CHUNK_SIZE, MAX_FAILURE_RATE, fetch_movie_details
from cinematch.warehouse import connect_warehouse

log = logging.getLogger(__name__)

MIN_RATINGS = 10  # un film noté par moins de 10 utilisateurs est trop peu connu pour être recommandé
PARALLEL_REQUESTS = 8  # l'API TMDB accepte une cinquantaine de requêtes par seconde


def read_csv(key: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(lake.get_bytes(key).decode("utf-8"))))


def candidate_tmdb_ids(version: str) -> list[int]:
    """Les identifiants TMDB des films MovieLens notés au moins MIN_RATINGS fois (lus dans Bronze)."""
    keys = bronze_keys(version)
    counts = Counter(row["movieId"] for row in read_csv(keys["ratings.csv"]))
    return sorted(
        int(row["tmdbId"])
        for row in read_csv(keys["links.csv"])
        if row["tmdbId"] and counts[row["movieId"]] >= MIN_RATINGS
    )


def already_in_silver() -> set[int]:
    """Les films qui ont déjà leur fiche dans Silver. Vide au tout premier passage (table pas encore publiée)."""
    try:
        with connect_warehouse() as conn, conn.cursor() as cur:
            cur.execute("select tmdb_id from silver.tmdb_movies")
            return {row[0] for row in cur.fetchall()}
    except psycopg2.errors.UndefinedTable:
        return set()


NOT_ON_TMDB = "absent"  # le film n'existe plus sur TMDB (404) : ce n'est pas une panne
FAILED = "echec"  # erreur réseau, serveur TMDB indisponible… : une panne, comptée dans le contrôle qualité


def fetch(movie_id: int) -> dict | str:
    """Renvoie la fiche du film, ou NOT_ON_TMDB / FAILED."""
    try:
        return fetch_movie_details(movie_id)
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 404:
            log.info("Film %s absent de TMDB (supprimé ou fusionné) : ignoré", movie_id)
            return NOT_ON_TMDB
        log.warning("Film %s en échec : %s", movie_id, error)
        return FAILED
    except requests.RequestException as error:
        log.warning("Film %s en échec : %s", movie_id, error)
        return FAILED


def run(ingest_date: str, version: str = "ml-latest-small", limit: int | None = None) -> dict:
    ingested_at = datetime.now(UTC).isoformat()
    prefix = f"bronze/tmdb/catalog_details/ingest_date={ingest_date}/"
    lake.delete_prefix(prefix)  # idempotence : la partition du jour est réécrite

    known = already_in_silver()
    to_fetch = [tmdb_id for tmdb_id in candidate_tmdb_ids(version) if tmdb_id not in known][:limit]
    log.info("%d fiches à récupérer (%d déjà dans Silver)", len(to_fetch), len(known))

    with ThreadPoolExecutor(max_workers=PARALLEL_REQUESTS) as pool:
        results = list(pool.map(fetch, to_fetch))
    details = [{**movie, "_ingested_at": ingested_at} for movie in results if isinstance(movie, dict)]
    missing, failed = results.count(NOT_ON_TMDB), results.count(FAILED)

    for number, start in enumerate(range(0, len(details), CHUNK_SIZE), start=1):
        lake.put_jsonl(f"{prefix}part-{number:04d}.jsonl", details[start : start + CHUNK_SIZE])

    stats = {"a_recuperer": len(to_fetch), "fiches": len(details), "absents_de_tmdb": missing, "echecs": failed}
    log.info("Ingestion du catalogue TMDB du %s terminée : %s", ingest_date, stats)
    # Contrôle qualité sur les vraies pannes seulement. Les films absents de TMDB sont redemandés chaque jour
    # (ils ne sont jamais dans Silver) : les compter ferait échouer la tâche à 100 % dès le deuxième passage.
    if to_fetch and failed / len(to_fetch) > MAX_FAILURE_RATE:
        raise RuntimeError(f"Taux d'échec trop élevé : {failed}/{len(to_fetch)} films")
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Ingestion des fiches TMDB du catalogue MovieLens vers Bronze")
    parser.add_argument("--date", default=datetime.now(UTC).date().isoformat(), help="date d'ingestion (AAAA-MM-JJ)")
    parser.add_argument("--version", default="ml-latest-small", help="version MovieLens (ml-latest-small, ml-32m)")
    parser.add_argument("--limit", type=int, default=None, help="nombre maximal de fiches (pour un test)")
    args = parser.parse_args()
    run(args.date, args.version, args.limit)


if __name__ == "__main__":
    main()
