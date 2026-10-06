-- Dimension film : 1 ligne par film (tmdb_id).
-- Elle réunit les films à fiche TMDB complète (films tendance) et les films MovieLens (titre + année seulement),
-- pour que toutes les notes MovieLens puissent s'y rattacher. La note IMDb est la plus récente connue.
with tmdb_movies as (
    select * from {{ ref('stg_tmdb__movies') }}
),

movielens_movies as (
    -- un tmdb_id peut (rarement) correspondre à plusieurs films MovieLens : on n'en garde qu'un
    select distinct on (tmdb_id) *
    from {{ ref('stg_movielens__movies') }}
    where tmdb_id is not null
    order by tmdb_id, movielens_movie_id
),

latest_imdb as (
    -- la note IMDb la plus récente de chaque film
    select distinct on (imdb_id)
        imdb_id,
        imdb_rating,
        imdb_num_votes,
        snapshot_date as imdb_rating_date
    from {{ ref('stg_imdb__ratings_daily') }}
    order by imdb_id, snapshot_date desc
),

catalog as (
    -- full outer join : on garde les films présents d'un seul côté ou des deux
    select
        coalesce(tmdb.tmdb_id, ml.tmdb_id) as tmdb_id,
        coalesce(tmdb.imdb_id, ml.imdb_id) as imdb_id,
        ml.movielens_movie_id,
        coalesce(tmdb.title, ml.title) as title,
        tmdb.original_title,
        tmdb.original_language,
        tmdb.release_date,
        coalesce(extract(year from tmdb.release_date)::int, ml.release_year) as release_year,
        tmdb.runtime_minutes,
        tmdb.tmdb_vote_average,
        tmdb.tmdb_vote_count,
        tmdb.poster_path,
        tmdb.is_adult,
        tmdb.tmdb_id is not null as has_tmdb_details
    from tmdb_movies as tmdb
    full outer join movielens_movies as ml
        on tmdb.tmdb_id = ml.tmdb_id
)

select
    catalog.tmdb_id,
    catalog.imdb_id,
    catalog.movielens_movie_id,
    catalog.title,
    catalog.original_title,
    catalog.original_language,
    catalog.release_date,
    catalog.release_year,
    catalog.runtime_minutes,
    case
        when catalog.runtime_minutes is null then 'inconnue'
        when catalog.runtime_minutes < 90 then '< 1h30'
        when catalog.runtime_minutes <= 120 then '1h30 - 2h'
        else '> 2h'
    end as runtime_bucket,
    catalog.tmdb_vote_average,
    catalog.tmdb_vote_count,
    latest_imdb.imdb_rating,
    latest_imdb.imdb_num_votes,
    latest_imdb.imdb_rating_date,
    catalog.poster_path,
    catalog.is_adult,
    catalog.has_tmdb_details
from catalog
left join latest_imdb
    on catalog.imdb_id = latest_imdb.imdb_id
