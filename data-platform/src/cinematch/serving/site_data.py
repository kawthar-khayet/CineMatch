"""Données du site web, préparées à partir de la couche Gold : les films classés et les chiffres clés.

Les classements, notes et explications viennent de Gold (mart_hype_or_gem). Pour l'affichage seulement, chaque film
est complété par sa fiche TMDB en anglais, la langue du site (affiche, résumé, genres, réalisateur, acteurs) : les
films MovieLens n'ont pas de fiche TMDB dans le pipeline (limite connue, voir docs/recap/00).
Ces données sont publiées dans la base de service par cinematch.serving.publish.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor

import psycopg2
import psycopg2.extras

from cinematch.ingestion.tmdb import _get
from cinematch.recommendation.collaborative import item_neighbors
from cinematch.warehouse import connect_warehouse

log = logging.getLogger(__name__)

MOVIES_QUERY = """
    select tmdb_id, title, release_year, runtime_bucket, category, explanation,
           imdb_rating, imdb_num_votes, is_trending, trending_rank, trending_date
    from marts.mart_hype_or_gem
    order by is_trending desc, trending_rank, imdb_rating desc nulls last
"""

STATS_QUERIES = {
    "catalog_size": "select count(*) from marts.dim_movie",
    "catalog_movies": "select count(*) from marts.dim_movie where is_movie",
    "people": "select count(*) from marts.dim_person",
    "movielens_ratings": "select count(*) from marts.fact_ratings",
    "movielens_users": "select count(distinct user_id) from marts.fact_ratings",
    "imdb_daily_ratings": "select count(*) from marts.fact_imdb_ratings_daily",
    "trending_snapshots": "select count(distinct snapshot_date) from marts.fact_trending_daily",
}


TRAILING_ARTICLE = re.compile(r"^(?P<rest>.+), (?P<article>The|A|An|Le|La|Les|L'|Il|Lo|Der|Die|Das|El|Los)$")


def _restore_article(title: str) -> str:
    """MovieLens met l'article à la fin : « Hole, The » → « The Hole », « Armée, L' » → « L'Armée »."""
    match = TRAILING_ARTICLE.match(title.strip())
    if not match:
        return title.strip()
    separator = "" if match["article"].endswith("'") else " "
    return f"{match['article']}{separator}{match['rest']}"


def movielens_english_title(title: str, original: str | None) -> str:
    """Titre anglais d'après MovieLens, qui ajoute les titres alternatifs entre parenthèses.

    « Human Condition III, The (Ningen no joken III) » : le titre principal est l'anglais.
    « Trou, Le (Hole, The) (Night Watch, The) » : le titre principal est l'original, l'anglais est entre parenthèses.
    """
    main = _restore_article(re.sub(r"\s*\([^()]*\)", "", title))
    alternatives = re.findall(r"\(([^()]+)\)", title)
    if alternatives and original and main.casefold() == original.casefold():
        return _restore_article(alternatives[0])
    return main


def english_title(movie: dict) -> str:
    """Titre anglais : celui de TMDB, sauf s'il n'est que le titre original (pas de traduction anglaise sur TMDB)."""
    tmdb_title = movie.get("title_en")
    untranslated = tmdb_title == movie.get("original_title") and movie.get("original_language") != "en"
    if tmdb_title and not untranslated:
        return tmdb_title
    return movielens_english_title(movie["title"], movie.get("original_title"))


def display_title(english: str, original: str | None, original_language: str | None) -> str:
    """Titre affiché : l'anglais, ou pour un film étranger le titre original suivi de sa traduction anglaise."""
    if original and original_language != "en" and original.casefold() != english.casefold():
        return f"{original} ({english})"
    return english


def fetch_tmdb_en(tmdb_id: int) -> dict:
    """Fiche TMDB en anglais, réduite à ce que le site affiche. Renvoie {} si le film est introuvable."""
    try:
        data = _get(f"/movie/{tmdb_id}", {"append_to_response": "credits", "language": "en-US"})
    except Exception as error:  # un film retiré de TMDB ne doit pas bloquer l'export
        log.warning("Fiche TMDB %s indisponible : %s", tmdb_id, error)
        return {}
    crew = data.get("credits", {}).get("crew", [])
    cast = data.get("credits", {}).get("cast", [])
    return {
        "title_en": data.get("title"),
        "original_title": data.get("original_title"),
        "original_language": data.get("original_language"),
        "overview": data.get("overview") or None,
        "poster_path": data.get("poster_path"),
        "backdrop_path": data.get("backdrop_path"),
        "runtime_minutes": data.get("runtime") or None,
        "genres": [genre["name"] for genre in data.get("genres", [])],
        "directors": [person["name"] for person in crew if person.get("job") == "Director"][:2],
        "cast": [person["name"] for person in sorted(cast, key=lambda p: p.get("order", 99))][:4],
    }


def build() -> tuple[list[dict], dict]:
    """Renvoie les films classés (enrichis de leur fiche TMDB) et les chiffres clés du pipeline."""
    with connect_warehouse() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(MOVIES_QUERY)
        movies = [dict(row) for row in cur.fetchall()]
        stats = {}
        for name, query in STATS_QUERIES.items():
            cur.execute(query)
            stats[name] = list(cur.fetchone().values())[0]

    # 8 requêtes TMDB en parallèle : ~230 films en une vingtaine de secondes
    with ThreadPoolExecutor(max_workers=8) as pool:
        details = list(pool.map(fetch_tmdb_en, [movie["tmdb_id"] for movie in movies]))
    for movie, detail in zip(movies, details, strict=True):
        movie.update(detail)
        movie["display_title"] = display_title(
            english_title(movie), movie.get("original_title"), movie.get("original_language")
        )

    categories: dict[str, int] = {}
    for movie in movies:
        categories[movie["category"]] = categories.get(movie["category"], 0) + 1
    stats["categories"] = categories
    trending_date = next((m["trending_date"] for m in movies if m.get("trending_date")), None)
    stats["trending_date"] = trending_date.isoformat() if trending_date else None
    return movies, stats


FEATURES_QUERY = """
    select tmdb_id, title, original_title, original_language, release_year, runtime_minutes, poster_path,
           imdb_rating, imdb_num_votes, movielens_num_ratings, movielens_avg_rating, genres, directors, main_cast
    from marts.mart_movie_features
"""

RATINGS_QUERY = """
    select ratings.user_id, ratings.tmdb_id, ratings.rating
    from marts.fact_ratings as ratings
    inner join marts.mart_movie_features as features on ratings.tmdb_id = features.tmdb_id
"""


def build_reco_catalog() -> list[dict]:
    """Films recommandables (mart_movie_features), chacun avec ses voisins collaboratifs (notes MovieLens)."""
    with connect_warehouse() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(FEATURES_QUERY)
        movies = [dict(row) for row in cur.fetchall()]
        cur.execute(RATINGS_QUERY)
        ratings = [(row["user_id"], row["tmdb_id"], float(row["rating"])) for row in cur.fetchall()]

    neighbors = item_neighbors(ratings, [movie["tmdb_id"] for movie in movies])
    for movie in movies:
        movie["display_title"] = display_title(movie["title"], movie["original_title"], movie["original_language"])
        movie["neighbors"] = [{"id": other, "score": score} for other, score in neighbors.get(movie["tmdb_id"], [])]
    log.info("%d films recommandables, %d notes MovieLens utilisées", len(movies), len(ratings))
    return movies
