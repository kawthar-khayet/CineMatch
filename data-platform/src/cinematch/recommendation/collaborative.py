"""Filtrage collaboratif « item-item » : les films aimés par les mêmes spectateurs se ressemblent.

Pour chaque paire de films, on compare les notes des utilisateurs MovieLens qui ont vu les deux :
similarité cosinus sur les notes centrées (on retire la moyenne de chaque utilisateur, car certains notent
sévèrement, d'autres généreusement), puis on la pondère par le nombre de spectateurs communs
(« shrinkage ») : une ressemblance observée sur 3 personnes compte moins que sur 50.
Résultat : pour chaque film, ses TOP_K voisins les plus proches, utilisés par le site pour recommander.
"""

import numpy as np

TOP_K = 20  # voisins gardés par film
SHRINKAGE = 10  # avec 10 spectateurs communs, la similarité est divisée par 2


def item_neighbors(ratings: list[tuple[int, int, float]], movie_ids: list[int]) -> dict[int, list[tuple[int, float]]]:
    """ratings : (user_id, tmdb_id, note). Renvoie {tmdb_id: [(voisin, similarité), …]} pour les films de movie_ids."""
    movie_index = {movie_id: i for i, movie_id in enumerate(movie_ids)}
    rows = [(user, movie_index[movie], rating) for user, movie, rating in ratings if movie in movie_index]
    if not rows:
        return {}
    user_index = {user: i for i, user in enumerate(sorted({user for user, _, _ in rows}))}

    # Matrice films × utilisateurs : note centrée sur la moyenne de l'utilisateur, 0 si pas de note
    ratings_matrix = np.zeros((len(movie_ids), len(user_index)))
    seen = np.zeros_like(ratings_matrix)
    for user, movie, rating in rows:
        ratings_matrix[movie, user_index[user]] = rating
        seen[movie, user_index[user]] = 1.0
    user_means = ratings_matrix.sum(axis=0) / np.maximum(seen.sum(axis=0), 1)
    centered = (ratings_matrix - user_means) * seen

    # Cosinus entre toutes les paires de films, en une multiplication de matrices
    norms = np.linalg.norm(centered, axis=1)
    norms[norms == 0] = 1.0
    similarity = (centered @ centered.T) / np.outer(norms, norms)
    common_viewers = seen @ seen.T
    similarity *= common_viewers / (common_viewers + SHRINKAGE)
    np.fill_diagonal(similarity, 0.0)

    neighbors = {}
    for i, movie_id in enumerate(movie_ids):
        best = np.argsort(similarity[i])[::-1][:TOP_K]
        neighbors[movie_id] = [(movie_ids[j], round(float(similarity[i, j]), 3)) for j in best if similarity[i, j] > 0]
    return neighbors
