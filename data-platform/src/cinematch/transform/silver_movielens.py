"""Bronze → Silver pour MovieLens : typage, conversion des dates, harmonisation des identifiants.

Tables produites (remplacées entièrement : le jeu de données est figé) :
  movielens_ratings  1 ligne par utilisateur × film
  movielens_links    1 ligne par film MovieLens, avec ses identifiants IMDb et TMDB
  movielens_movies   1 ligne par film MovieLens (titre, genres) : sert aux vérifications

Exécution : docker compose run --rm spark-jobs python -m cinematch.transform.silver_movielens
"""

import argparse
import logging

from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from cinematch.spark_session import get_spark, lake_path
from cinematch.transform.delta_io import overwrite_delta

log = logging.getLogger(__name__)


def read_csv(spark: SparkSession, dataset: str, version: str) -> DataFrame:
    return spark.read.option("header", True).csv(lake_path("bronze", "movielens", dataset, f"snapshot={version}"))


def ratings(raw: DataFrame) -> DataFrame:
    return raw.select(
        F.col("userId").cast("int").alias("user_id"),
        F.col("movieId").cast("int").alias("movielens_movie_id"),
        F.col("rating").cast("double"),
        # timestamp Unix (secondes depuis le 1er janvier 1970) → vraie date et heure
        F.timestamp_seconds(F.col("timestamp").cast("long")).alias("rated_at"),
    )


def links(raw: DataFrame) -> DataFrame:
    return raw.select(
        F.col("movieId").cast("int").alias("movielens_movie_id"),
        # MovieLens écrit 1375666 ; IMDb et TMDB écrivent tt1375666 (au moins 7 chiffres)
        F.concat(F.lit("tt"), F.lpad("imdbId", 7, "0")).alias("imdb_id"),
        F.col("tmdbId").cast("long").alias("tmdb_id"),
    )


def movies(raw: DataFrame) -> DataFrame:
    return raw.select(
        F.col("movieId").cast("int").alias("movielens_movie_id"),
        F.col("title"),
        F.col("genres").alias("genres_pipe_separated"),
    )


def run(version: str = "ml-latest-small") -> None:
    spark = get_spark("silver_movielens")
    try:
        tables = {
            "movielens_ratings": ratings(read_csv(spark, "ratings", version)),
            "movielens_links": links(read_csv(spark, "links", version)),
            "movielens_movies": movies(read_csv(spark, "movies", version)),
        }
        for name, df in tables.items():
            path = lake_path("silver", name)
            overwrite_delta(df, path)
            log.info("%-18s : %d lignes", name, spark.read.format("delta").load(path).count())
    finally:
        spark.stop()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Bronze → Silver pour MovieLens")
    parser.add_argument("--version", default="ml-latest-small", help="ml-latest-small ou ml-32m")
    run(parser.parse_args().version)


if __name__ == "__main__":
    main()
