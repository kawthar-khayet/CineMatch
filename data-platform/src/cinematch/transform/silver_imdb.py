"""Bronze → Silver pour IMDb : les notes du jour, limitées aux films qui nous intéressent.

Table produite :
  imdb_ratings_daily  1 ligne par jour × film (historique des notes et des votes)

Prérequis : silver_tmdb et silver_movielens doivent avoir été exécutés (ils définissent les films à garder).
Exécution : docker compose run --rm spark-jobs python -m cinematch.transform.silver_imdb --date 2026-10-05
"""

import argparse
import logging
from datetime import datetime, timezone

from delta.tables import DeltaTable
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql import functions as F

from cinematch.spark_session import get_spark, lake_path
from cinematch.transform.delta_io import upsert_delta

log = logging.getLogger(__name__)


def catalog_imdb_ids(spark: SparkSession) -> DataFrame:
    """Les identifiants IMDb des films de notre catalogue : TMDB + MovieLens, sans doublon."""
    sources = {"tmdb_movies": lake_path("silver", "tmdb_movies"), "movielens_links": lake_path("silver", "movielens_links")}
    for name, path in sources.items():
        if not DeltaTable.isDeltaTable(spark, path):
            raise RuntimeError(f"La table Silver {name} n'existe pas : lancez d'abord silver_tmdb et silver_movielens")
    tmdb = spark.read.format("delta").load(sources["tmdb_movies"]).select("imdb_id")
    movielens = spark.read.format("delta").load(sources["movielens_links"]).select("imdb_id")
    return tmdb.union(movielens).where(F.col("imdb_id").isNotNull()).distinct()


def ratings_daily(raw: DataFrame, catalog: DataFrame, ingest_date: str) -> DataFrame:
    return (
        raw.join(catalog, raw.tconst == catalog.imdb_id, "left_semi")  # garde seulement les films du catalogue
        .select(
            F.to_date(F.lit(ingest_date)).alias("snapshot_date"),
            F.col("tconst").alias("imdb_id"),
            F.col("averageRating").cast("double").alias("imdb_rating"),
            F.col("numVotes").cast("int").alias("imdb_num_votes"),
        )
    )


def run(ingest_date: str) -> None:
    spark = get_spark("silver_imdb")
    try:
        # Spark décompresse lui-même le .gz ; IMDb écrit \N pour une valeur absente
        raw = (
            spark.read.option("header", True)
            .option("sep", "\t")
            .option("nullValue", "\\N")
            .csv(lake_path("bronze", "imdb", "title_ratings", f"ingest_date={ingest_date}"))
        )
        df = ratings_daily(raw, catalog_imdb_ids(spark), ingest_date)

        path = lake_path("silver", "imdb_ratings_daily")
        upsert_delta(spark, df, path, ["snapshot_date", "imdb_id"])
        log.info(
            "imdb_ratings_daily : %d lignes gardées ce jour sur %d dans le fichier IMDb",
            spark.read.format("delta").load(path).where(F.col("snapshot_date") == ingest_date).count(),
            raw.count(),
        )
    finally:
        spark.stop()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Bronze → Silver pour IMDb")
    parser.add_argument(
        "--date", default=datetime.now(timezone.utc).date().isoformat(), help="partition Bronze à traiter (AAAA-MM-JJ)"
    )
    run(parser.parse_args().date)


if __name__ == "__main__":
    main()
