"""Publication de la couche de service : Gold → base de service (PostgreSQL sur Azure) → site web.

Le site (Azure App Service) ne lit pas l'entrepôt local : il lit cette base de service, qui ne contient que ce
qu'il affiche.
Étapes : préparer les données (site_data.build), les écrire en une transaction, puis prévenir le site
pour qu'il rafraîchisse son cache tout de suite (sinon il le fait de lui-même, au plus tard une heure après).

Exécution : python -m cinematch.serving.publish (tâche publish_serving du DAG cinematch_batch_daily)
"""

import json
import logging
import os
from datetime import UTC, datetime

import psycopg2
import psycopg2.extras
import requests

from cinematch.serving.site_data import build, build_reco_catalog

log = logging.getLogger(__name__)

# Créées si besoin : la publication fonctionne sur une base de service vide
DDL = """
create schema if not exists serving;

create table if not exists serving.movies (
    tmdb_id            bigint primary key,
    display_title      text not null,
    title              text,
    original_title     text,
    original_language  text,
    release_year       integer,
    runtime_minutes    integer,
    runtime_bucket     text,
    category           text not null,
    explanation        text not null,
    imdb_rating        double precision,
    imdb_num_votes     integer,
    is_trending        boolean not null,
    trending_rank      integer,
    trending_date      date,
    overview           text,
    poster_path        text,
    backdrop_path      text,
    genres             text[],
    directors          text[],
    cast_members       text[]
);

create table if not exists serving.reco_movies (
    tmdb_id               bigint primary key,
    display_title         text not null,
    release_year          integer,
    runtime_minutes       integer,
    poster_path           text,
    imdb_rating           double precision,
    imdb_num_votes        integer,
    movielens_num_ratings integer not null,
    movielens_avg_rating  double precision,
    genres                text[] not null,
    directors             text[] not null,
    main_cast             text[] not null,
    neighbors             jsonb not null  -- [{"id": tmdb_id, "score": similarité}, …] (filtrage collaboratif)
);

create table if not exists serving.pipeline_stats (
    id            integer primary key default 1 check (id = 1),  -- une seule ligne
    stats         jsonb not null,
    published_at  timestamptz not null
);
"""

MOVIE_COLUMNS = [
    "tmdb_id", "display_title", "title", "original_title", "original_language", "release_year",
    "runtime_minutes", "runtime_bucket", "category", "explanation", "imdb_rating", "imdb_num_votes",
    "is_trending", "trending_rank", "trending_date", "overview", "poster_path", "backdrop_path",
    "genres", "directors", "cast_members",
]  # fmt: skip

RECO_COLUMNS = [
    "tmdb_id", "display_title", "release_year", "runtime_minutes", "poster_path", "imdb_rating", "imdb_num_votes",
    "movielens_num_ratings", "movielens_avg_rating", "genres", "directors", "main_cast", "neighbors",
]  # fmt: skip


def serving_url() -> str:
    """Adresse de la base de service (SERVING_DATABASE_URL dans .env)."""
    url = os.getenv("SERVING_DATABASE_URL")
    if not url:
        raise RuntimeError("Variable manquante dans .env : SERVING_DATABASE_URL")
    return url


def write(movies: list[dict], reco_movies: list[dict], stats: dict) -> datetime:
    """Remplace le contenu de la base de service, en une seule transaction : le site ne voit jamais un état partiel."""
    published_at = datetime.now(UTC)
    rows = [
        tuple({**movie, "cast_members": movie.get("cast")}.get(column) for column in MOVIE_COLUMNS) for movie in movies
    ]
    with psycopg2.connect(serving_url()) as conn, conn.cursor() as cur:
        cur.execute(DDL)
        cur.execute("delete from serving.movies")
        psycopg2.extras.execute_values(cur, f"insert into serving.movies ({', '.join(MOVIE_COLUMNS)}) values %s", rows)
        cur.execute("delete from serving.reco_movies")
        reco_rows = [
            tuple(psycopg2.extras.Json(movie[c]) if c == "neighbors" else movie[c] for c in RECO_COLUMNS)
            for movie in reco_movies
        ]
        psycopg2.extras.execute_values(
            cur, f"insert into serving.reco_movies ({', '.join(RECO_COLUMNS)}) values %s", reco_rows
        )
        cur.execute(
            """insert into serving.pipeline_stats (id, stats, published_at) values (1, %s, %s)
               on conflict (id) do update set stats = excluded.stats, published_at = excluded.published_at""",
            (json.dumps(stats), published_at),
        )
    # « with psycopg2.connect » valide la transaction (commit) en sortie de bloc
    return published_at


def notify_site() -> None:
    """Demande au site de rafraîchir son cache. Facultatif : sans SITE_URL, le site se rafraîchit seul en 1 h."""
    site_url, secret = os.getenv("SITE_URL"), os.getenv("SITE_REVALIDATE_SECRET")
    if not site_url or not secret:
        log.info("SITE_URL ou SITE_REVALIDATE_SECRET absent : le site se rafraîchira de lui-même")
        return
    response = requests.post(
        f"{site_url.rstrip('/')}/api/revalidate", headers={"Authorization": f"Bearer {secret}"}, timeout=30
    )
    response.raise_for_status()
    log.info("Site prévenu (%s) : cache rafraîchi", site_url)


def run() -> None:
    movies, stats = build()
    reco_movies = build_reco_catalog()
    stats["recommendable_movies"] = len(reco_movies)
    published_at = write(movies, reco_movies, stats)
    log.info("%d films publiés dans la base de service (%s)", len(movies), published_at.isoformat(timespec="seconds"))
    notify_site()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run()
