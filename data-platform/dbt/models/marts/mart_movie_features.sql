-- Caractéristiques des films recommandables : 1 ligne par film.
-- Base de la recommandation par le contenu (genres, réalisateurs, acteurs principaux, durée),
-- avec la popularité MovieLens qui sert aussi au filtrage collaboratif.
-- Un film est recommandable s'il a une fiche TMDB complète et qu'il est assez connu pour qu'on le juge :
-- noté au moins 10 fois sur MovieLens, ou au moins 1 000 fois sur IMDb (cas des films récents).
with movielens_popularity as (
    select
        tmdb_id,
        count(*) as movielens_num_ratings,
        round(avg(rating)::numeric, 2)::double precision as movielens_avg_rating
    from {{ ref('fact_ratings') }}
    where tmdb_id is not null
    group by tmdb_id
),

genres as (
    select
        bridge.tmdb_id,
        array_agg(genre.genre_name order by genre.genre_name) as genres
    from {{ ref('bridge_movie_genre') }} as bridge
    inner join {{ ref('dim_genre') }} as genre
        on bridge.genre_id = genre.genre_id
    group by bridge.tmdb_id
),

people as (
    select
        bridge.tmdb_id,
        array_agg(person.person_name order by person.person_name)
            filter (where bridge.role = 'director') as directors,
        -- les 5 premiers rôles du générique : ceux qui caractérisent le film
        array_agg(person.person_name order by bridge.cast_order)
            filter (where bridge.role = 'actor' and bridge.cast_order < 5) as main_cast
    from {{ ref('bridge_movie_person') }} as bridge
    inner join {{ ref('dim_person') }} as person
        on bridge.person_id = person.person_id
    group by bridge.tmdb_id
)

select
    movie.tmdb_id,
    movie.title,
    movie.original_title,
    movie.original_language,
    movie.release_year,
    movie.runtime_minutes,
    movie.poster_path,
    movie.imdb_rating,
    movie.imdb_num_votes,
    coalesce(popularity.movielens_num_ratings, 0) as movielens_num_ratings,
    popularity.movielens_avg_rating,
    coalesce(genres.genres, '{}') as genres,
    coalesce(people.directors, '{}') as directors,
    coalesce(people.main_cast, '{}') as main_cast
from {{ ref('dim_movie') }} as movie
left join movielens_popularity as popularity
    on movie.tmdb_id = popularity.tmdb_id
left join genres
    on movie.tmdb_id = genres.tmdb_id
left join people
    on movie.tmdb_id = people.tmdb_id
where movie.has_tmdb_details
    and not coalesce(movie.is_adult, false)
    and (coalesce(popularity.movielens_num_ratings, 0) >= 10 or coalesce(movie.imdb_num_votes, 0) >= 1000)
