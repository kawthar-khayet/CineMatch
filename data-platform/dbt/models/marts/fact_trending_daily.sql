-- Fait « classement tendance » : 1 ligne par jour × film.
-- Mesures : trending_rank, tmdb_popularity. Dimensions : dim_movie (tmdb_id), dim_date (date_key).
--
-- Incrémental : chaque exécution ne traite que les nouveaux jours (et retraite le dernier jour connu,
-- au cas où l'ingestion de ce jour aurait été relancée). unique_key évite les doublons.
{{
    config(
        materialized='incremental',
        unique_key=['snapshot_date', 'tmdb_id']
    )
}}

select
    snapshot_date,
    to_char(snapshot_date, 'YYYYMMDD')::int as date_key,
    tmdb_id,
    trending_rank,
    tmdb_popularity
from {{ ref('stg_tmdb__trending_daily') }}

{% if is_incremental() %}
where snapshot_date >= (select max(snapshot_date) from {{ this }})
{% endif %}
