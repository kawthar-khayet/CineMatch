# ADR 0003 — Plateforme locale de référence, portage sur Databricks en bonus

**Statut** : accepté

## Contexte
Databricks est très demandé dans les offres de stage. Mais la grille du PFE exige Docker
et une démo fiable, et la Databricks Free Edition a des limites : quota journalier,
calcul serverless uniquement, accès Internet sortant restreint, pas d'accès aux services locaux.

## Options étudiées
- **A. Tout en local** : couvre toute la grille, mais Databricks n'apparaît pas.
- **B. Tout sur Databricks** : Docker et streaming plus faibles, démo dépendante du quota.
- **C. Hybride** : plateforme locale complète, puis portage de la logique Spark et Delta sur Databricks.

## Décision
Option **C**. La version locale est la référence (soutenance, CI, démo). Le pipeline
Bronze → Silver → Gold est porté sur Databricks Free Edition (Unity Catalog, Job, Asset Bundle),
à partir d'un instantané de Bronze.

## Conséquences
- (+) Toute la grille est couverte, et Databricks peut figurer sur le CV avec une preuve concrète.
- (+) Cela impose une bonne pratique : séparer la logique de transformation des entrées/sorties.
- (−) Environ 1 à 2 jours de travail en plus ; ingestion et streaming restent locaux.
- (−) La Gold Databricks n'est qu'un sous-ensemble (écarts de syntaxe SQL avec Postgres).
