-- Notes IMDb : 1 ligne par jour × film (films du catalogue uniquement)
select
    snapshot_date,
    imdb_id,
    imdb_rating,
    imdb_num_votes
from {{ source('silver', 'imdb_ratings_daily') }}
