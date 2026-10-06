-- Notes MovieLens, reliées aux identifiants TMDB et IMDb : 1 ligne par utilisateur × film
with ratings as (
    select * from {{ source('silver', 'movielens_ratings') }}
),

links as (
    select * from {{ source('silver', 'movielens_links') }}
)

select
    ratings.user_id,
    ratings.movielens_movie_id,
    links.tmdb_id,
    links.imdb_id,
    ratings.rating,
    ratings.rated_at
from ratings
left join links
    on ratings.movielens_movie_id = links.movielens_movie_id
