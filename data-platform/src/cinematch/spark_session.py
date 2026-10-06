"""Démarre une session Spark configurée pour Delta Lake et notre stockage objet S3 (RustFS)."""

from delta import configure_spark_with_delta_pip
from pyspark.sql import SparkSession

from cinematch.config import get_settings

# Connecteur S3A d'Hadoop : il permet à Spark de lire et d'écrire des chemins s3a://
EXTRA_PACKAGES = ["org.apache.hadoop:hadoop-aws:3.3.4"]


def get_spark(app_name: str) -> SparkSession:
    """Crée (ou réutilise) une session Spark locale, avec Delta Lake et l'accès au data lake."""
    settings = get_settings()
    builder = (
        SparkSession.builder.appName(app_name)
        .master("local[*]")
        .config("spark.driver.memory", "2g")
        .config("spark.sql.session.timeZone", "UTC")
        # Delta Lake
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config("spark.sql.catalog.spark_catalog", "org.apache.spark.sql.delta.catalog.DeltaCatalog")
        # Stockage objet compatible S3 (RustFS)
        .config("spark.hadoop.fs.s3a.impl", "org.apache.hadoop.fs.s3a.S3AFileSystem")
        .config("spark.hadoop.fs.s3a.endpoint", settings.s3_endpoint)
        .config("spark.hadoop.fs.s3a.access.key", settings.s3_access_key)
        .config("spark.hadoop.fs.s3a.secret.key", settings.s3_secret_key)
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.connection.ssl.enabled", "false")
    )
    spark = configure_spark_with_delta_pip(builder, extra_packages=EXTRA_PACKAGES).getOrCreate()
    spark.sparkContext.setLogLevel("WARN")
    return spark


def lake_path(*parts: str) -> str:
    """Chemin Spark (s3a://) dans le bucket du data lake, ex. lake_path("silver", "tmdb_movies")."""
    return "s3a://" + "/".join([get_settings().lakehouse_bucket, *parts])


if __name__ == "__main__":
    # Test de bout en bout : écrire une petite table Delta dans le data lake, puis la relire
    spark = get_spark("test_delta")
    path = lake_path("tests", "delta_test")
    movies = spark.createDataFrame(
        [(27205, "Inception", 148), (157336, "Interstellar", 169)],
        ["tmdb_id", "title", "runtime_minutes"],
    )
    movies.write.format("delta").mode("overwrite").save(path)
    print(f"Table Delta écrite dans {path}, relue :")
    spark.read.format("delta").load(path).orderBy("tmdb_id").show()
    spark.stop()
