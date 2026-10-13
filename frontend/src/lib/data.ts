// Types and display helpers shared by server and client components.
// The data itself is read from the serving database in lib/queries.ts.

export type Category =
  | "vraie_tendance"
  | "buzz_trompeur"
  | "tendance_moyenne"
  | "tendance_non_notee"
  | "pepite_cachee";

export type Movie = {
  tmdb_id: number;
  title: string;
  display_title: string;
  title_en?: string | null;
  original_title?: string | null;
  original_language?: string | null;
  release_year: number | null;
  runtime_bucket: string | null;
  runtime_minutes?: number | null;
  category: Category;
  explanation: string;
  imdb_rating: number | null;
  imdb_num_votes: number | null;
  is_trending: boolean;
  trending_rank: number | null;
  trending_date: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: string[];
  directors?: string[];
  cast?: string[];
};

export type Stats = {
  catalog_size: number;
  catalog_movies: number;
  people: number;
  movielens_ratings: number;
  movielens_users: number;
  imdb_daily_ratings: number;
  trending_snapshots: number;
  categories: Record<Category, number>;
  trending_date: string | null;
  recommendable_movies: number;
  published_at: string;
};

export const CATEGORIES: Record<
  Category,
  { label: string; emoji: string; rule: string; badge: string; accent: string }
> = {
  vraie_tendance: {
    label: "True trend",
    emoji: "🔥",
    rule: "Trending and rated at least 7/10 on IMDb by at least 1,000 voters: the hype is deserved.",
    badge: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
    accent: "text-orange-300",
  },
  buzz_trompeur: {
    label: "Overhyped",
    emoji: "⚠️",
    rule: "Trending, but rated below 6/10 by at least 1,000 voters: more talked about than it deserves.",
    badge: "bg-red-500/15 text-red-300 ring-red-500/30",
    accent: "text-red-300",
  },
  pepite_cachee: {
    label: "Hidden gem",
    emoji: "💎",
    rule: "Not trending, a movie rated at least 8/10 with 5,000 to 50,000 votes: excellent and little known.",
    badge: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    accent: "text-sky-300",
  },
  tendance_moyenne: {
    label: "Mixed reviews",
    emoji: "😐",
    rule: "Trending, with a rating between 6 and 7/10 from at least 1,000 voters.",
    badge: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
    accent: "text-zinc-300",
  },
  tendance_non_notee: {
    label: "Not rated yet",
    emoji: "⏳",
    rule: "Trending, but no IMDb rating yet, or fewer than 1,000 votes (often a movie that just came out).",
    badge: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
    accent: "text-violet-300",
  },
};

// Display order of the categories
export const CATEGORY_ORDER: Category[] = [
  "vraie_tendance",
  "pepite_cachee",
  "buzz_trompeur",
  "tendance_moyenne",
  "tendance_non_notee",
];

// English title, or for a foreign movie: original title followed by the English one (computed by the export)
export function displayTitle(movie: Movie): string {
  return movie.display_title || movie.title;
}

export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function posterUrl(path: string | null | undefined, size: "w342" | "w500" = "w342"): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export function backdropUrl(path: string | null | undefined): string | null {
  return path ? `https://image.tmdb.org/t/p/w1280${path}` : null;
}

export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export function moviesIn(movies: Movie[], category: Category): Movie[] {
  return movies.filter((movie) => movie.category === category);
}
