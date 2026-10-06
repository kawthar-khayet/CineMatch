-- Fait « note » : 1 ligne par note d'un utilisateur MovieLens pour un film.
-- Mesure : rating (0,5 à 5). Dimensions : dim_movie (tmdb_id), dim_date (date_key).
select
    user_id,
    movielens_movie_id,
    tmdb_id,
    to_char(rated_at, 'YYYYMMDD')::int as date_key,
    rated_at,
    rating
from {{ ref('stg_movielens__ratings') }}
