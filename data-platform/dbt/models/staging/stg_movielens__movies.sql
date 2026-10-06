-- Films MovieLens : 1 ligne par film, avec ses identifiants TMDB / IMDb et l'année extraite du titre
-- MovieLens écrit l'année dans le titre : « Inception (2010) » → titre « Inception », année 2010
with movies as (
    select * from {{ source('silver', 'movielens_movies') }}
),

links as (
    select * from {{ source('silver', 'movielens_links') }}
)

select
    movies.movielens_movie_id,
    links.tmdb_id,
    links.imdb_id,
    trim(regexp_replace(movies.title, '\s*\(\d{4}\)\s*$', '')) as title,
    cast(substring(movies.title from '\((\d{4})\)\s*$') as int) as release_year,
    movies.genres_pipe_separated
from movies
left join links
    on movies.movielens_movie_id = links.movielens_movie_id
