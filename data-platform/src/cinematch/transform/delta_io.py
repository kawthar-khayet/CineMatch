"""Écriture des tables Silver au format Delta Lake."""

from delta.tables import DeltaTable
from pyspark.sql import DataFrame, SparkSession


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
