import type { Metadata } from "next";
import { Suspense } from "react";
import { RadarExplorer } from "@/components/RadarExplorer";
import { formatDate } from "@/lib/data";
import { getMovies, getStats } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Hype Check",
  description: "Every movie ranked by the Hype or Hidden Gem index: true trends, overhyped movies and hidden gems.",
};

export default async function HypeCheckPage() {
  const [movies, stats] = await Promise.all([getMovies(), getStats()]);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">Hype Check: is it worth the buzz?</h1>
      <p className="mt-3 max-w-3xl text-muted">
        {movies.length} movies ranked from the TMDB trends of {formatDate(stats.trending_date)} and the IMDb ratings of
        the same day. Every ranking comes with its explanation.
      </p>
      <div className="mt-8">
        <Suspense>
          <RadarExplorer movies={movies} counts={stats.categories} />
        </Suspense>
      </div>
    </div>
  );
}
