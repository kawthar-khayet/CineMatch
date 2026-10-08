-- Informations IMDb de chaque titre du catalogue : 1 ligne par titre
-- title_type permet de distinguer les films (movie) des séries, épisodes, documentaires TV…
select
    imdb_id,
    title_type,
    primary_title,
    start_year,
    runtime_minutes,
    genres_comma_separated
from {{ source('silver', 'imdb_titles') }}
