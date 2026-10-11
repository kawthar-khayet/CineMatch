/* eslint-disable @next/next/no-img-element -- images served already resized by the TMDB CDN */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryBadge } from "@/components/CategoryBadge";
import { MovieRow, Poster } from "@/components/MovieCard";
import {
  backdropUrl,
  CATEGORIES,
  displayTitle,
  formatDate,
  formatNumber,
  languageName,
  moviesIn,
} from "@/lib/data";
import { getMovie, getMovies } from "@/lib/queries";

// One page per movie, generated at build time
// (movies that enter the Hype Check later are rendered on their first visit, then cached)
export async function generateStaticParams() {
  const movies = await getMovies();
  return movies.map((movie) => ({ id: String(movie.tmdb_id) }));
}

export async function generateMetadata(props: PageProps<"/film/[id]">): Promise<Metadata> {
  const movie = await getMovie(Number((await props.params).id));
  if (!movie) return {};
  return { title: displayTitle(movie), description: movie.explanation };
}

export default async function FilmPage(props: PageProps<"/film/[id]">) {
  const movie = await getMovie(Number((await props.params).id));
  if (!movie) notFound();

  const meta = CATEGORIES[movie.category];
  const backdrop = backdropUrl(movie.backdrop_path);
  const language = languageName(movie.original_language);
  const similar = moviesIn(await getMovies(), movie.category)
    .filter((other) => other.tmdb_id !== movie.tmdb_id && other.poster_path)
    .slice(0, 12);

  const facts = [
    { label: "IMDb rating", value: movie.imdb_rating != null ? `${movie.imdb_rating.toFixed(1)} / 10` : "Not rated yet" },
    { label: "IMDb votes", value: formatNumber(movie.imdb_num_votes) },
    {
      label: "TMDB trending",
      value: movie.trending_rank != null ? `#${movie.trending_rank} on ${formatDate(movie.trending_date)}` : "Not trending",
    },
    { label: "Runtime", value: movie.runtime_minutes ? `${movie.runtime_minutes} min` : movie.runtime_bucket ?? "—" },
  ];

  return (
    <div>
      <section className="relative overflow-hidden border-b border-border">
        {backdrop && (
          <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25 blur-[2px]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[220px_1fr] sm:py-16">
          <div className="mx-auto w-48 sm:w-full">
            <Poster movie={movie} size="w500" />
          </div>
          <div>
            <Link href="/hype-check" className="text-sm text-muted hover:text-foreground">
              ← Back to the Hype Check
            </Link>
            <h1 className="mt-3 text-3xl font-bold sm:text-5xl">{displayTitle(movie)}</h1>
            <p className="mt-2 text-muted">
              {[movie.release_year, movie.genres?.join(", "), language && language !== "English" ? language : null]
                .filter(Boolean)
                .join(" · ")}
            </p>

            <div className="mt-6 rounded-xl border border-border bg-surface/80 p-5 backdrop-blur">
              <CategoryBadge category={movie.category} size="md" />
              <p className={`mt-3 text-lg font-medium ${meta.accent}`}>{movie.explanation}</p>
              <p className="mt-1 text-sm text-muted">Rule: {meta.rule}</p>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-xs uppercase tracking-wide text-muted">{fact.label}</dt>
                  <dd className="mt-1 font-medium">{fact.value}</dd>
                </div>
              ))}
            </dl>

            {movie.overview && <p className="mt-6 max-w-3xl leading-relaxed text-foreground/90">{movie.overview}</p>}

            <div className="mt-6 space-y-1 text-sm">
              {movie.directors && movie.directors.length > 0 && (
                <p>
                  <span className="text-muted">Directed by </span>
                  {movie.directors.join(", ")}
                </p>
              )}
              {movie.cast && movie.cast.length > 0 && (
                <p>
                  <span className="text-muted">Starring </span>
                  {movie.cast.join(", ")}
                </p>
              )}
            </div>

            <a
              href={`https://www.themoviedb.org/movie/${movie.tmdb_id}`}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block text-sm text-amber-400 hover:text-amber-300"
            >
              View on TMDB ↗
            </a>
          </div>
        </div>
      </section>

      {similar.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-10">
          <h2 className="mb-4 text-xl font-bold">
            More {meta.emoji} {meta.label}
          </h2>
          <MovieRow movies={similar} />
        </section>
      )}
    </div>
  );
}
