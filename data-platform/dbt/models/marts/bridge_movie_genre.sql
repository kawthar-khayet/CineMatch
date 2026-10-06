-- Table de pont film ↔ genre : 1 ligne par film × genre
select
    tmdb_id,
    genre_id
from {{ ref('stg_tmdb__movie_genres') }}
