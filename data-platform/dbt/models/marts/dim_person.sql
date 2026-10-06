-- Dimension personne : 1 ligne par acteur ou réalisateur, avec ses rôles et son nombre de films au catalogue
select
    person_id,
    max(person_name) as person_name,
    bool_or(role = 'actor') as is_actor,
    bool_or(role = 'director') as is_director,
    count(distinct tmdb_id) as movie_count
from {{ ref('stg_tmdb__movie_people') }}
group by person_id
