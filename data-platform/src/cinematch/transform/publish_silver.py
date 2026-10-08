"""Publie les tables Silver (Delta, dans le data lake) vers Postgres (schéma silver), point d'entrée de dbt.

Exécution : docker compose run --rm spark-jobs python -m cinematch.transform.publish_silver
"""

import logging

from cinematch.spark_session import get_spark
from cinematch.transform.delta_io import publish_to_warehouse

log = logging.getLogger(__name__)

SILVER_TABLES = [
    "tmdb_movies",
    "tmdb_movie_genres",
    "tmdb_movie_people",
    "tmdb_trending_daily",
    "imdb_ratings_daily",
    "imdb_titles",
    "movielens_ratings",
    "movielens_links",
    "movielens_movies",
]


def run() -> None:
    spark = get_spark("publish_silver")
    try:
        for table in SILVER_TABLES:
            rows = publish_to_warehouse(spark, table)
            log.info("silver.%-20s : %d lignes publiées dans Postgres", table, rows)
    finally:
        spark.stop()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run()
