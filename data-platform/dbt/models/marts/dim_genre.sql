-- Dimension genre : 1 ligne par genre TMDB (Action, Science Fiction…)
select
    genre_id,
    max(genre_name) as genre_name
from {{ ref('stg_tmdb__movie_genres') }}
group by genre_id
