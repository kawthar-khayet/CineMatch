-- Films TMDB : 1 ligne par film (état actuel)
select
    tmdb_id,
    imdb_id,
    title,
    original_title,
    original_language,
    release_date,
    runtime_minutes,
    tmdb_vote_average,
    tmdb_vote_count,
    popularity as tmdb_popularity,
    status,
    overview,
    poster_path,
    adult as is_adult,
    ingested_at
from {{ source('silver', 'tmdb_movies') }}
