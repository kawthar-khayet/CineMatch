"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { MovieCard } from "@/components/MovieCard";
import { CATEGORIES, CATEGORY_ORDER, displayTitle, type Category, type Movie } from "@/lib/data";

type Sort = "trending" | "rating" | "votes" | "year";

const SORTS: { value: Sort; label: string }[] = [
  { value: "trending", label: "Trending rank" },
  { value: "rating", label: "IMDb rating" },
  { value: "votes", label: "Number of votes" },
  { value: "year", label: "Newest" },
];

function isCategory(value: string | null): value is Category {
  return value != null && value in CATEGORIES;
}

function sortMovies(list: Movie[], sort: Sort): Movie[] {
  const byNullsLast = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity);
  return [...list].sort((a, b) => {
    switch (sort) {
      case "rating":
        return byNullsLast(a.imdb_rating, b.imdb_rating);
      case "votes":
        return byNullsLast(a.imdb_num_votes, b.imdb_num_votes);
      case "year":
        return byNullsLast(a.release_year, b.release_year);
      default:
        return (a.trending_rank ?? Infinity) - (b.trending_rank ?? Infinity) || byNullsLast(a.imdb_rating, b.imdb_rating);
    }
  });
}

export function RadarExplorer({ movies, counts }: { movies: Movie[]; counts: Record<Category, number> }) {
  const initial = useSearchParams().get("category");
  const [category, setCategory] = useState<Category | "all">(isCategory(initial) ? initial : "all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("trending");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = movies.filter(
      (movie) =>
        (category === "all" || movie.category === category) &&
        (!q ||
          displayTitle(movie).toLowerCase().includes(q) ||
          movie.title.toLowerCase().includes(q) ||
          movie.genres?.some((name) => name.toLowerCase().includes(q)) ||
          movie.directors?.some((name) => name.toLowerCase().includes(q)) ||
          movie.cast?.some((name) => name.toLowerCase().includes(q))),
    );
    return sortMovies(filtered, sort);
  }, [movies, category, query, sort]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm ring-1 ring-inset transition ${
      active ? "bg-amber-400 text-black ring-amber-400" : "ring-border text-muted hover:text-foreground hover:bg-surface"
    }`;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip(category === "all")} onClick={() => setCategory("all")}>
          All ({movies.length})
        </button>
        {CATEGORY_ORDER.map((key) => (
          <button key={key} type="button" className={chip(category === key)} onClick={() => setCategory(key)}>
            {CATEGORIES[key].label} ({counts[key] ?? 0})
          </button>
        ))}
      </div>

      {category !== "all" && <p className="mt-3 text-sm text-muted">{CATEGORIES[category].rule}</p>}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a title, genre, director or actor…"
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-amber-400"
        />
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
          aria-label="Sort by"
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-amber-400"
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              Sort: {option.label}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-4 text-sm text-muted">
        {visible.length} movie{visible.length === 1 ? "" : "s"}
      </p>

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-muted">No movie matches this search.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {visible.map((movie) => (
            <MovieCard key={movie.tmdb_id} movie={movie} />
          ))}
        </div>
      )}
    </div>
  );
}
