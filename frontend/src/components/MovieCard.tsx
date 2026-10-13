/* eslint-disable @next/next/no-img-element -- posters served already resized by the TMDB CDN */
import Link from "next/link";
import { CategoryBadge } from "@/components/CategoryBadge";
import { displayTitle, formatNumber, posterUrl, type Movie } from "@/lib/data";

export function Poster({ movie, size = "w342" }: { movie: Movie; size?: "w342" | "w500" }) {
  const url = posterUrl(movie.poster_path, size);
  if (!url) {
    return (
      <div className="flex aspect-[2/3] w-full items-center justify-center rounded-lg bg-surface p-3 text-center text-sm text-muted">
        {displayTitle(movie)}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Poster of ${displayTitle(movie)}`}
      loading="lazy"
      className="aspect-[2/3] w-full rounded-lg object-cover"
    />
  );
}

export function MovieCard({ movie }: { movie: Movie }) {
  return (
    <Link href={`/film/${movie.tmdb_id}`} className="group flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-lg ring-1 ring-border transition group-hover:ring-amber-400/60">
        <div className="transition duration-300 group-hover:scale-[1.03]">
          <Poster movie={movie} />
        </div>
        {movie.trending_rank != null && (
          <span className="absolute left-2 top-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold">
            #{movie.trending_rank}
          </span>
        )}
        {/* Too few votes: the rating is not reliable, so the card shows the number of votes instead */}
        {movie.imdb_rating != null &&
          (movie.category === "tendance_non_notee" ? (
            <span className="absolute right-2 top-2 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-muted">
              {formatNumber(movie.imdb_num_votes)} votes
            </span>
          ) : (
            <span className="absolute right-2 top-2 rounded-md bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-black">
              ★ {movie.imdb_rating.toFixed(1)}
            </span>
          ))}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-amber-300">
          {displayTitle(movie)}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <CategoryBadge category={movie.category} />
          {movie.release_year && <span>{movie.release_year}</span>}
        </div>
      </div>
    </Link>
  );
}

// Horizontal row, for the home page
export function MovieRow({ movies }: { movies: Movie[] }) {
  return (
    <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2">
      {movies.map((movie) => (
        <div key={movie.tmdb_id} className="w-36 shrink-0 snap-start sm:w-40">
          <MovieCard movie={movie} />
        </div>
      ))}
    </div>
  );
}
