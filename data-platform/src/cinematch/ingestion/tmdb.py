"""Ingestion TMDB : récupère les données de l'API The Movie Database.

Étape 1 : découverte de l'API (chargement du jeton, puis premiers appels).
"""

import os
import time

import requests
from dotenv import load_dotenv

# Lit le fichier .env et ajoute ses variables à l'environnement
load_dotenv()

TMDB_API_TOKEN = os.getenv("TMDB_API_TOKEN")
BASE_URL = "https://api.themoviedb.org/3"


def _get(path: str, params: dict | None = None) -> dict:
    """Envoie une requête GET à l'API TMDB et renvoie la réponse JSON."""
    response = requests.get(
        f"{BASE_URL}{path}",
        headers={
            "Authorization": f"Bearer {TMDB_API_TOKEN}",
            "accept": "application/json",
        },
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def fetch_trending(page: int = 1) -> dict:
    """Renvoie une page des films tendance du jour (réponse JSON complète)."""
    return _get("/trending/movie/day", {"page": page, "language": "en-US"})


def fetch_movie_details(movie_id: int) -> dict:
    """Renvoie la fiche complète d'un film, crédits inclus (réponse JSON complète)."""
    return _get(f"/movie/{movie_id}", {"append_to_response": "credits", "language": "en-US"})


if __name__ == "__main__":
    if not TMDB_API_TOKEN:
        print("Jeton introuvable : vérifiez le fichier .env")
    else:
        start = time.perf_counter()
        trending = fetch_trending()
        movies = []
        failed = []

        for rank, item in enumerate(trending["results"], start=1):
            try:
                movie = fetch_movie_details(item["id"])
            except requests.HTTPError as error:
                failed.append(item["id"])
                print(f"{rank:>2}. Film {item['id']} ignoré : {error}")
                continue

            movies.append(movie)
            directors = ", ".join(p["name"] for p in movie["credits"]["crew"] if p["job"] == "Director")
            runtime = movie["runtime"] or "?"
            print(f"{rank:>2}. {movie['title']} ({movie['release_date'][:4]}) - {runtime} min - {directors or '?'}")

        duration = time.perf_counter() - start
        print()
        print(f"{len(movies)} fiches récupérées, {len(failed)} échecs, en {duration:.1f} secondes")
