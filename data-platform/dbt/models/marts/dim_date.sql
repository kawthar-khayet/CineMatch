-- Dimension date : 1 ligne par jour, de 1995 (premières notes MovieLens) à 2030, générée en SQL
with days as (
    select generate_series('1995-01-01'::date, '2030-12-31'::date, interval '1 day')::date as date_day
)

select
    to_char(date_day, 'YYYYMMDD')::int as date_key,
    date_day,
    extract(year from date_day)::int as year,
    extract(quarter from date_day)::int as quarter,
    extract(month from date_day)::int as month,
    to_char(date_day, 'FMMonth') as month_name,
    extract(isodow from date_day)::int as day_of_week,  -- 1 = lundi … 7 = dimanche
    extract(isodow from date_day) in (6, 7) as is_weekend
from days
