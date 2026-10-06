-- Fait « note IMDb du jour » : 1 ligne par jour × film. C'est l'historique qui permettra de mesurer
-- la progression des votes (Radar Hype ou Pépite).
-- Mesures : imdb_rating, imdb_num_votes. Dimensions : dim_movie (tmdb_id), dim_date (date_key).
--
-- Le fait est rattaché au film par tmdb_id (la clé de dim_movie) : les quelques notes IMDb dont le film
-- n'est pas dans dim_movie (film MovieLens sans tmdb_id) sont écartées par la jointure interne.
{{
    config(
        materialized='incremental',
        unique_key=['snapshot_date', 'tmdb_id']
    )
}}

select
    imdb.snapshot_date,
    to_char(imdb.snapshot_date, 'YYYYMMDD')::int as date_key,
    movie.tmdb_id,
    imdb.imdb_id,
    imdb.imdb_rating,
    imdb.imdb_num_votes
from {{ ref('stg_imdb__ratings_daily') }} as imdb
inner join {{ ref('dim_movie') }} as movie
    on imdb.imdb_id = movie.imdb_id

{% if is_incremental() %}
where imdb.snapshot_date >= (select max(snapshot_date) from {{ this }})
{% endif %}
