# ADR 0002 — Spark en mode local dans les conteneurs Airflow

**Statut** : accepté

## Contexte
Le projet doit tourner sur un portable (8 à 16 Go de RAM) avec `docker compose up`.

## Décision
Spark (PySpark 3.5) est installé dans l'image Airflow et lancé en `local[*]`, un
processus par tâche (`python -m cinematch.transform...`). Les tâches Spark sont
exécutées séquentiellement.

## Alternatives écartées
- **Cluster Spark (master + workers)** : plus réaliste, mais plus de RAM et plus de
  configuration, sans bénéfice à cette volumétrie (environ 100 000 notes et 10 000 films).
- **SparkSubmitOperator / DockerOperator** : ajoute une dépendance au socket Docker,
  fragile sous Windows.

## Conséquences
- (+) Démarrage simple et reproductible ; le même code passerait sur un cluster en
  changeant `SPARK_MASTER`.
- (−) La montée en charge est limitée à une machine.
