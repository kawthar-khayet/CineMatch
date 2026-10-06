"""Écriture des tables Silver au format Delta Lake, et publication vers l'entrepôt Postgres."""

from delta.tables import DeltaTable
from pyspark.sql import DataFrame, SparkSession

from cinematch.config import get_settings
from cinematch.spark_session import lake_path


def upsert_delta(spark: SparkSession, df: DataFrame, path: str, keys: list[str]) -> None:
    """MERGE incrémental : met à jour les lignes existantes (même clé) et insère les nouvelles."""
    if DeltaTable.isDeltaTable(spark, path):
        condition = " AND ".join(f"t.{key} = s.{key}" for key in keys)
        (
            DeltaTable.forPath(spark, path)
            .alias("t")
            .merge(df.alias("s"), condition)
            .whenMatchedUpdateAll()
            .whenNotMatchedInsertAll()
            .execute()
        )
    else:
        # Première exécution : la table n'existe pas encore, on la crée
        df.write.format("delta").save(path)


def overwrite_delta(df: DataFrame, path: str) -> None:
    """Remplace entièrement une table Delta (pour les jeux de données figés, comme MovieLens)."""
    df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").save(path)


def publish_to_warehouse(spark: SparkSession, table: str) -> int:
    """Copie une table Silver (Delta) dans Postgres, schéma silver, et renvoie son nombre de lignes.

    truncate=true : la table Postgres est vidée puis rechargée, sans être supprimée.
    Les vues dbt construites dessus restent donc valides.
    """
    settings = get_settings()
    df = spark.read.format("delta").load(lake_path("silver", table))
    (
        df.write.format("jdbc")
        .option("url", settings.jdbc_url)
        .option("user", settings.postgres_user)
        .option("password", settings.postgres_password)
        .option("driver", "org.postgresql.Driver")  # sinon Java peut lever « No suitable driver »
        .option("dbtable", f"silver.{table}")
        .option("truncate", "true")
        .mode("overwrite")
        .save()
    )
    return df.count()
