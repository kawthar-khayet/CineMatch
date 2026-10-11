# ADR 0001 — Lakehouse Delta pour Bronze/Silver, Postgres + dbt pour Gold

**Statut** : accepté

## Contexte
Le projet doit démontrer à la fois un data lake (stockage brut bon marché, rejouable)
et une modélisation analytique testée et documentée.

## Décision
- Bronze et Silver dans un stockage objet compatible S3 au format **Delta Lake**, transformés par **Spark**.
  (Prévu avec MinIO, finalement RustFS : l'image MinIO a été retirée de Docker Hub ; aucun changement de code
  grâce au protocole S3.)
- Les tables Silver sont **publiées dans Postgres** (schéma `silver`), où **dbt**
  construit la couche Gold (étoile, SCD2, métriques).

## Alternatives écartées
- **dbt-spark** : nécessite un Thrift Server Spark, lourd à faire tourner en local.
- **dbt-duckdb lisant Delta directement** : plus léger, mais l'accès S3 via
  l'extension Delta est moins mature ; Postgres sert aussi à Metabase et au producteur.

## Conséquences
- (+) Chaque outil est utilisé là où il est le plus fort ; Gold est requêtable par n'importe quel outil BI.
- (−) Silver existe en deux exemplaires (Delta et Postgres). Acceptable à cette volumétrie ;
  en production, on visera un moteur unique (Trino, Databricks ou Snowflake).
