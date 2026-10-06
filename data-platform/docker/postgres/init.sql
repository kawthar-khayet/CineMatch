-- Exécuté UNE SEULE FOIS, à la création du volume de Postgres, dans la base POSTGRES_DB.

-- Schéma qui reçoit la copie des tables Silver (publiées par Spark) ; dbt construit Gold à partir de lui
CREATE SCHEMA IF NOT EXISTS silver;
