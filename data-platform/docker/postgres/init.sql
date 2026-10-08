-- Exécuté UNE SEULE FOIS, à la création du volume de Postgres, dans la base POSTGRES_DB.
-- (Sur une base déjà créée, ces commandes doivent être lancées à la main.)

-- Base de métadonnées d'Airflow : historique des exécutions, états des tâches, utilisateurs…
CREATE DATABASE airflow;

-- Schéma qui reçoit la copie des tables Silver (publiées par Spark) ; dbt construit Gold à partir de lui
CREATE SCHEMA IF NOT EXISTS silver;
