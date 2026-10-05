# ADR 0004 — Airflow plutôt que Dagster pour l'orchestration

**Statut** : accepté (2026-10-04)

## Contexte
Il faut un orchestrateur pour enchaîner l'ingestion, les transformations Spark, dbt,
le streaming en micro-batchs et la recommandation. Deux candidats ont été étudiés :
Apache Airflow et Dagster.

## Options étudiées
- **Dagster** : approche par *assets* (on décrit les données plutôt que les tâches),
  intégration native avec dbt, lignage visuel, partitions par jour, contrôles qualité intégrés.
  Mais il est beaucoup moins présent dans les offres de stage.
- **Airflow** : le standard du marché, une très grande communauté. Depuis la version 3,
  il propose lui aussi une notion d'*assets*.

## Décision
**Airflow.** L'objectif prioritaire du projet est de décrocher un stage de PFE dans un délai
d'un mois : Airflow est la compétence la plus demandée, et son usage limite le risque sur
un planning déjà chargé (MovieLens 32M, streaming, recommandation).

## Conséquences
- (+) Une compétence directement valorisable dans les offres et en entretien.
- (+) Beaucoup de documentation et d'exemples disponibles.
- (−) Le lignage vient de `dbt docs` plutôt que d'un graphe d'assets intégré.
- **Perspective** : après le PFE, réécrire la couche d'orchestration avec Dagster, en gardant
  les mêmes fonctions Python et les mêmes modèles dbt, pour comparer les deux approches.
