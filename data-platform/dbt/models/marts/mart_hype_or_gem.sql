-- Indice « Hype ou Pépite » (version 1) : croise le buzz (liste tendance TMDB du dernier jour)
-- et la qualité (note IMDb) pour classer les films. 1 ligne par film classé.
--
-- Version 1 = des approximations, faute d'historique : le buzz est la PRÉSENCE dans la liste tendance,
-- et la notoriété d'un film hors tendance est approchée par son nombre de votes IMDb.
-- Version 2 (plus tard) : la PROGRESSION du buzz (export quotidien TMDB, progression des votes IMDb).
-- Les seuils sont des variables (vars) définies dans dbt_project.yml.
with latest_trending as (
    -- le classement du dernier jour disponible
    select tmdb_id, trending_rank, snapshot_date as trending_date
    from {{ ref('fact_trending_daily') }}
    where snapshot_date = (select max(snapshot_date) from {{ ref('fact_trending_daily') }})
),

movies as (
    select
        movie.tmdb_id,
        movie.title,
        movie.release_year,
        movie.runtime_bucket,
        movie.imdb_rating,
        movie.imdb_num_votes,
        movie.poster_path,
        trending.trending_rank,
        trending.trending_date,
        trending.tmdb_id is not null as is_trending
    from {{ ref('dim_movie') }} as movie
    left join latest_trending as trending
        on movie.tmdb_id = trending.tmdb_id
    where not coalesce(movie.is_adult, false)
),

classified as (
    select
        *,
        case
            when is_trending and imdb_rating is null then 'tendance_non_notee'
            when is_trending and imdb_rating >= {{ var('true_trend_min_rating') }} then 'vraie_tendance'
            when is_trending and imdb_rating < {{ var('misleading_max_rating') }} then 'buzz_trompeur'
            when is_trending then 'tendance_moyenne'
            when imdb_rating >= {{ var('gem_min_rating') }}
                and imdb_num_votes between {{ var('gem_min_votes') }} and {{ var('gem_max_votes') }}
                then 'pepite_cachee'
        end as category
    from movies
)

select
    tmdb_id,
    title,
    release_year,
    runtime_bucket,
    category,
    case category
        when 'vraie_tendance' then 'n°' || trending_rank || ' en tendance, et bien noté : ' || imdb_rating || '/10 sur IMDb'
        when 'buzz_trompeur' then 'n°' || trending_rank || ' en tendance, mais seulement ' || imdb_rating || '/10 sur IMDb'
        when 'tendance_moyenne' then 'n°' || trending_rank || ' en tendance, avec une note moyenne : ' || imdb_rating || '/10 sur IMDb'
        when 'tendance_non_notee' then 'n°' || trending_rank || ' en tendance, pas encore assez noté sur IMDb'
        when 'pepite_cachee' then imdb_rating || '/10 sur IMDb, mais seulement ' || imdb_num_votes || ' votes : peu connu'
    end as explanation,
    imdb_rating,
    imdb_num_votes,
    is_trending,
    trending_rank,
    trending_date,
    poster_path
from classified
where category is not null
