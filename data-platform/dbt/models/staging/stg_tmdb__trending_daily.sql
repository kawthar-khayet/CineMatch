-- Classement tendance TMDB : 1 ligne par jour × film
select
    snapshot_date,
    tmdb_id,
    rank as trending_rank,
    popularity as tmdb_popularity
from {{ source('silver', 'tmdb_trending_daily') }}
