// Reads the serving database (Postgres on Neon), filled every day by the Airflow task publish_serving.
// Results are cached for an hour, and refreshed immediately when Airflow calls /api/revalidate.
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import postgres from "postgres";
import type { Movie, Stats } from "@/lib/data";
import type { RecoMovie } from "@/lib/recommend";

export const SERVING_TAG = "serving";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set: add the serving database URL to .env.local (or to Vercel)");
}

// prepare: false is required by Neon's connection pooler
const sql = postgres(url, { prepare: false, max: 3 });

type MovieRow = Omit<Movie, "cast"> & { cast_members: string[] | null };

const MOVIE_COLUMNS = sql`
  tmdb_id::int as tmdb_id, display_title, title, original_title, original_language, release_year, runtime_minutes,
  runtime_bucket, category, explanation, imdb_rating, imdb_num_votes, is_trending, trending_rank,
  trending_date::text as trending_date, overview, poster_path, backdrop_path, genres, directors, cast_members
`;

function toMovie({ cast_members, ...row }: MovieRow): Movie {
  return { ...row, cast: cast_members ?? [] };
}

export async function getMovies(): Promise<Movie[]> {
  "use cache";
  cacheTag(SERVING_TAG);
  cacheLife("hours");
  const rows = await sql<MovieRow[]>`
    select ${MOVIE_COLUMNS} from serving.movies
    order by is_trending desc, trending_rank, imdb_rating desc nulls last
  `;
  return rows.map(toMovie);
}

export async function getMovie(id: number): Promise<Movie | undefined> {
  "use cache";
  cacheTag(SERVING_TAG);
  cacheLife("hours");
  const rows = await sql<MovieRow[]>`select ${MOVIE_COLUMNS} from serving.movies where tmdb_id = ${id}`;
  return rows[0] ? toMovie(rows[0]) : undefined;
}

export async function getStats(): Promise<Stats> {
  "use cache";
  cacheTag(SERVING_TAG);
  cacheLife("hours");
  const [row] = await sql<{ stats: Omit<Stats, "published_at">; published_at: Date }[]>`
    select stats, published_at from serving.pipeline_stats where id = 1
  `;
  return { ...row.stats, published_at: row.published_at.toISOString() };
}

// Catalog of recommendable movies (mart_movie_features + collaborative neighbors), in a compact form
export async function getRecoCatalog(): Promise<RecoMovie[]> {
  "use cache";
  cacheTag(SERVING_TAG);
  cacheLife("hours");
  const rows = await sql<
    {
      tmdb_id: number;
      display_title: string;
      release_year: number | null;
      runtime_minutes: number | null;
      poster_path: string | null;
      imdb_rating: number | null;
      imdb_num_votes: number | null;
      movielens_num_ratings: number;
      genres: string[];
      directors: string[];
      main_cast: string[];
      neighbors: { id: number; score: number }[];
    }[]
  >`
    select tmdb_id::int as tmdb_id, display_title, release_year, runtime_minutes, poster_path, imdb_rating,
           imdb_num_votes, movielens_num_ratings, genres, directors, main_cast, neighbors
    from serving.reco_movies
    order by movielens_num_ratings desc
  `;
  return rows.map((row) => ({
    id: row.tmdb_id,
    title: row.display_title,
    year: row.release_year,
    runtime: row.runtime_minutes,
    poster: row.poster_path,
    rating: row.imdb_rating,
    votes: row.imdb_num_votes,
    popularity: row.movielens_num_ratings,
    genres: row.genres,
    directors: row.directors,
    cast: row.main_cast,
    neighbors: row.neighbors.map((n) => [n.id, n.score] as [number, number]),
  }));
}
