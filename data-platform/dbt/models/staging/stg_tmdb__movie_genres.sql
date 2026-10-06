-- Genres des films TMDB : 1 ligne par film × genre
select
    tmdb_id,
    genre_id,
    genre_name
from {{ source('silver', 'tmdb_movie_genres') }}
