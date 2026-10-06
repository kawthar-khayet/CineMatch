-- Acteurs et réalisateurs des films TMDB : 1 ligne par film × personne × rôle
select
    tmdb_id,
    person_id,
    person_name,
    role,
    character_name,
    cast_order
from {{ source('silver', 'tmdb_movie_people') }}
