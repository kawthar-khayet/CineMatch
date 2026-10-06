-- Table de pont film ↔ personne : 1 ligne par film × personne × rôle.
-- Base des parcours de découverte (« les autres films de cet acteur / de ce réalisateur »).
select
    tmdb_id,
    person_id,
    role,
    character_name,
    cast_order
from {{ ref('stg_tmdb__movie_people') }}
