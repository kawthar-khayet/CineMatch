"""Bronze → Silver pour TMDB : aplatit le JSON brut en 4 tables Delta.

Tables produites :
  tmdb_movies          1 ligne par film (état actuel)
  tmdb_movie_genres    1 ligne par film × genre
  tmdb_movie_people    1 ligne par film × personne × rôle (15 premiers acteurs + réalisateurs)
  tmdb_trending_daily  1 ligne par jour × film (rang dans la liste tendance)

Exécution : docker compose run --rm spark-jobs python -m cinematch.transform.silver_tmdb --date 2026-10-05
"""

import argparse
import logging
from datetime import datetime, timezone

from pyspark.sql import DataFrame
from pyspark.sql import functions as F

from cinematch.spark_session import get_spark, lake_path
from cinematch.transform.delta_io import upsert_delta

log = logging.getLogger(__name__)

MAX_CAST_ORDER = 15  # au-delà, ce sont des rôles secondaires, peu utiles à la recommandation
PAGE_SIZE = 20  # nombre de films par page dans la liste tendance de TMDB


def movies(raw: DataFrame) -> DataFrame:
    """Les champs simples de chaque fiche : 1 ligne par film."""
    return (
        raw.select(
            F.col("id").cast("long").alias("tmdb_id"),
            F.col("imdb_id"),
            F.col("title"),
            F.col("original_title"),
            F.col("original_language"),
            F.to_date("release_date").alias("release_date"),
            # TMDB renvoie 0 quand la durée est inconnue : on la remplace par une valeur vide
            F.when(F.col("runtime") > 0, F.col("runtime").cast("int")).alias("runtime_minutes"),
            F.col("vote_average").cast("double").alias("tmdb_vote_average"),
            F.col("vote_count").cast("int").alias("tmdb_vote_count"),
            F.col("popularity").cast("double"),
            F.col("status"),
            F.col("overview"),
            F.col("poster_path"),
            F.col("adult").cast("boolean"),
            F.to_timestamp("_ingested_at").alias("ingested_at"),
        )
        .where(F.col("tmdb_id").isNotNull())
        .dropDuplicates(["tmdb_id"])
    )


def movie_genres(raw: DataFrame) -> DataFrame:
    """La liste des genres devient une ligne par genre (explode)."""
    return (
        raw.select(F.col("id").cast("long").alias("tmdb_id"), F.explode("genres").alias("g"))
        .select("tmdb_id", F.col("g.id").cast("int").alias("genre_id"), F.col("g.name").alias("genre_name"))
        .dropDuplicates(["tmdb_id", "genre_id"])
    )


def movie_people(raw: DataFrame) -> DataFrame:
    """Les 15 premiers acteurs et les réalisateurs : une ligne par film × personne × rôle."""
    base = raw.select(F.col("id").cast("long").alias("tmdb_id"), "credits")

    actors = (
        base.select("tmdb_id", F.explode("credits.cast").alias("p"))
        .where(F.col("p.order") < MAX_CAST_ORDER)
        .select(
            "tmdb_id",
            F.col("p.id").cast("long").alias("person_id"),
            F.col("p.name").alias("person_name"),
            F.lit("actor").alias("role"),
            F.col("p.character").alias("character_name"),
            F.col("p.order").cast("int").alias("cast_order"),
        )
    )
    directors = (
        base.select("tmdb_id", F.explode("credits.crew").alias("p"))
        .where(F.col("p.job") == "Director")
        .select(
            "tmdb_id",
            F.col("p.id").cast("long").alias("person_id"),
            F.col("p.name").alias("person_name"),
            F.lit("director").alias("role"),
            F.lit(None).cast("string").alias("character_name"),
            F.lit(None).cast("int").alias("cast_order"),
        )
    )
    return actors.unionByName(directors).dropDuplicates(["tmdb_id", "person_id", "role"])


def trending_daily(raw_pages: DataFrame, ingest_date: str) -> DataFrame:
    """Les pages brutes deviennent un classement : 1 ligne par film, avec son rang du jour."""
    return (
        # posexplode : comme explode, mais donne aussi la position (0, 1, 2…) de chaque film dans sa page
        raw_pages.select("_page", F.posexplode("results").alias("position", "m"))
        .select(
            F.to_date(F.lit(ingest_date)).alias("snapshot_date"),
            ((F.col("_page") - 1) * PAGE_SIZE + F.col("position") + 1).alias("rank"),
            F.col("m.id").cast("long").alias("tmdb_id"),
            F.col("m.popularity").cast("double").alias("popularity"),
        )
        # un film présent sur deux pages ne garde que son meilleur rang
        .groupBy("snapshot_date", "tmdb_id")
        .agg(F.min("rank").alias("rank"), F.max("popularity").alias("popularity"))
    )


def run(ingest_date: str) -> None:
    spark = get_spark("silver_tmdb")
    try:
        partition = f"ingest_date={ingest_date}"
        details = spark.read.json(lake_path("bronze", "tmdb", "movie_details", partition))
        pages = spark.read.json(lake_path("bronze", "tmdb", "trending", partition))

        tables = {
            "tmdb_movies": (movies(details), ["tmdb_id"]),
            "tmdb_movie_genres": (movie_genres(details), ["tmdb_id", "genre_id"]),
            "tmdb_movie_people": (movie_people(details), ["tmdb_id", "person_id", "role"]),
            "tmdb_trending_daily": (trending_daily(pages, ingest_date), ["snapshot_date", "tmdb_id"]),
        }
        for name, (df, keys) in tables.items():
            path = lake_path("silver", name)
            upsert_delta(spark, df, path, keys)
            log.info("%-20s : %d lignes au total", name, spark.read.format("delta").load(path).count())
    finally:
        spark.stop()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Bronze → Silver pour TMDB")
    parser.add_argument(
        "--date", default=datetime.now(timezone.utc).date().isoformat(), help="partition Bronze à traiter (AAAA-MM-JJ)"
    )
    run(parser.parse_args().date)


if __name__ == "__main__":
    main()
