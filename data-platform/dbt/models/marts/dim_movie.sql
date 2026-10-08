-- Dimension film : 1 ligne par film (tmdb_id).
-- Elle réunit les films à fiche TMDB complète (films tendance) et les films MovieLens (titre + année seulement),
-- pour que toutes les notes MovieLens puissent s'y rattacher. La note IMDb est la plus récente connue.
-- IMDb apporte aussi le type de contenu (film, série, épisode…) et la durée quand TMDB ne la connaît pas.
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

imdb_titles as (
    select * from {{ ref('stg_imdb__titles') }}
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
        tmdb.runtime_minutes as tmdb_runtime_minutes,
        tmdb.tmdb_vote_average,
        tmdb.tmdb_vote_count,
        tmdb.poster_path,
        tmdb.is_adult,
        tmdb.tmdb_id is not null as has_tmdb_details
    from tmdb_movies as tmdb
    full outer join movielens_movies as ml
        on tmdb.tmdb_id = ml.tmdb_id
),

enriched as (
    select
        catalog.*,
        -- la durée TMDB fait foi ; IMDb la complète quand TMDB ne la connaît pas
        coalesce(catalog.tmdb_runtime_minutes, imdb_titles.runtime_minutes) as runtime_minutes,
        imdb_titles.title_type as content_type,
        imdb_titles.title_type = 'movie' as is_movie
    from catalog
    left join imdb_titles
        on catalog.imdb_id = imdb_titles.imdb_id
)

select
    enriched.tmdb_id,
    enriched.imdb_id,
    enriched.movielens_movie_id,
    enriched.title,
    enriched.original_title,
    enriched.original_language,
    enriched.release_date,
    enriched.release_year,
    enriched.content_type,
    coalesce(enriched.is_movie, false) as is_movie,
    enriched.runtime_minutes,
    case
        when enriched.runtime_minutes is null then 'inconnue'
        when enriched.runtime_minutes < 90 then '< 1h30'
        when enriched.runtime_minutes <= 120 then '1h30 - 2h'
        else '> 2h'
    end as runtime_bucket,
    enriched.tmdb_vote_average,
    enriched.tmdb_vote_count,
    latest_imdb.imdb_rating,
    latest_imdb.imdb_num_votes,
    latest_imdb.imdb_rating_date,
    enriched.poster_path,
    enriched.is_adult,
    enriched.has_tmdb_details
from enriched
left join latest_imdb
    on enriched.imdb_id = latest_imdb.imdb_id
