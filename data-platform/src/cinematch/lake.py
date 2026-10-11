"""Accès au data lake (stockage objet compatible S3) : déposer et lire des fichiers."""

import json
import logging
from functools import cache

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from cinematch.config import get_settings

log = logging.getLogger(__name__)


def get_s3_client():
    """Crée un client S3 configuré pour notre stockage objet (RustFS en local)."""
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}),
    )


@cache
def ensure_bucket() -> str:
    """Crée le bucket du data lake s'il n'existe pas, et renvoie son nom.

    @cache : la vérification n'a lieu qu'une fois par processus, pas à chaque fichier déposé.
    """
    bucket = get_settings().lakehouse_bucket
    client = get_s3_client()
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as error:
        if error.response["Error"]["Code"] not in ("404", "NoSuchBucket", "NotFound"):
            raise  # autre erreur (identifiants, réseau…) : on ne la masque pas
        client.create_bucket(Bucket=bucket)
        log.info("Bucket %s créé dans le data lake", bucket)
    return bucket


def bronze_key(source: str, dataset: str, ingest_date: str, filename: str) -> str:
    """Construit le chemin d'un fichier Bronze, partitionné par date d'ingestion."""
    return f"bronze/{source}/{dataset}/ingest_date={ingest_date}/{filename}"


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Dépose des données dans le bucket du data lake, à la clé indiquée."""
    get_s3_client().put_object(
        Bucket=ensure_bucket(),
        Key=key,
        Body=data,
        ContentType=content_type,
    )


def put_jsonl(key: str, records: list[dict]) -> None:
    """Dépose une liste d'objets au format JSON Lines (un objet JSON par ligne)."""
    body = "\n".join(json.dumps(record, ensure_ascii=False) for record in records)
    put_bytes(key, body.encode("utf-8"), "application/x-ndjson")


def exists(key: str) -> bool:
    """Indique si un fichier existe dans le data lake (commande HEAD : rien n'est téléchargé)."""
    try:
        get_s3_client().head_object(Bucket=ensure_bucket(), Key=key)
        return True
    except ClientError as error:
        if error.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def get_bytes(key: str) -> bytes:
    """Lit un fichier du data lake."""
    return get_s3_client().get_object(Bucket=ensure_bucket(), Key=key)["Body"].read()


def has_prefix(prefix: str) -> bool:
    """Indique si au moins un fichier commence par ce préfixe (ex. une partition Bronze)."""
    response = get_s3_client().list_objects_v2(Bucket=ensure_bucket(), Prefix=prefix, MaxKeys=1)
    return response.get("KeyCount", 0) > 0


def delete_prefix(prefix: str) -> int:
    """Supprime tous les fichiers dont la clé commence par ce préfixe, et renvoie leur nombre."""
    client = get_s3_client()
    bucket = ensure_bucket()
    deleted = 0
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        if objects:
            client.delete_objects(Bucket=bucket, Delete={"Objects": objects})
            deleted += len(objects)
    return deleted


if __name__ == "__main__":
    test_key = "tests/hello.txt"
    put_bytes(test_key, b"Bonjour depuis CineMatch !", "text/plain")
    print(f"Fichier déposé : s3://{get_settings().lakehouse_bucket}/{test_key}")
