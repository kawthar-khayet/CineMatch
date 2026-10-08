-- Test métier : une « pépite cachée » doit toujours être un film (pas un épisode, une série ou un documentaire TV).
-- Un test dbt « singulier » est une requête qui doit renvoyer ZÉRO ligne : chaque ligne renvoyée est une erreur.
select
    gem.tmdb_id,
    gem.title,
    movie.content_type
from {{ ref('mart_hype_or_gem') }} as gem
inner join {{ ref('dim_movie') }} as movie
    on gem.tmdb_id = movie.tmdb_id
where gem.category = 'pepite_cachee'
    and not movie.is_movie
