import Link from "next/link";
import { CategoryBadge } from "@/components/CategoryBadge";
import { MovieRow } from "@/components/MovieCard";
import { CATEGORIES, formatDate, formatNumber, moviesIn, type Category } from "@/lib/data";
import { getMovies, getStats } from "@/lib/queries";

const SECTIONS: { category: Category; title: string }[] = [
  { category: "vraie_tendance", title: "The hype is deserved" },
  { category: "pepite_cachee", title: "Gems nobody is watching" },
  { category: "buzz_trompeur", title: "More hype than quality" },
];

export default async function Home() {
  const [movies, stats] = await Promise.all([getMovies(), getStats()]);
  const keyFigures = [
    { value: formatNumber(stats.catalog_size), label: "movies analyzed", detail: "ratings checked every day" },
    { value: formatNumber(stats.categories.vraie_tendance), label: "true trends", detail: "hype that is deserved" },
    { value: formatNumber(stats.categories.pepite_cachee), label: "hidden gems", detail: "excellent and little known" },
    { value: formatNumber(stats.categories.buzz_trompeur), label: "overhyped movies", detail: "more buzz than quality" },
    { value: formatNumber(stats.recommendable_movies), label: "movies to recommend", detail: "matched to your tastes" },
  ];
  const rows = SECTIONS.map(({ category, title }) => ({
    category,
    title,
    movies: moviesIn(movies, category)
      .filter((movie) => movie.poster_path)
      .slice(0, 12),
  }));

  return (
    <div>
      {/* --- Hero --- */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.14),transparent_60%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:py-24">
          <p className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-amber-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Trends of {formatDate(stats.trending_date)} · updated daily
          </p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Is this movie a <span className="text-orange-400">true trend</span>, or a{" "}
            <span className="text-sky-400">hidden gem</span> nobody is watching?
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Streaming platforms recommend what is already popular, without telling you whether the hype is deserved.
            Every day, CineMatch crosses <strong className="text-foreground">TMDB trends</strong> with{" "}
            <strong className="text-foreground">IMDb ratings</strong> to tell you, movie by movie, with an explanation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/hype-check"
              className="rounded-lg bg-amber-400 px-5 py-2.5 font-semibold text-black transition hover:bg-amber-300"
            >
              Run the Hype Check
            </Link>
            <Link
              href="/recommend"
              className="rounded-lg border border-border px-5 py-2.5 font-semibold transition hover:bg-surface"
            >
              Get recommendations
            </Link>
          </div>
        </div>
      </section>

      {/* --- Key figures --- */}
      <section className="mx-auto max-w-6xl px-4 py-10">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {keyFigures.map((figure) => (
            <div key={figure.label} className="flex flex-col-reverse rounded-xl border border-border bg-surface p-4">
              <dt className="mt-1 text-sm">
                {figure.label}
                <span className="block text-xs text-muted">{figure.detail}</span>
              </dt>
              <dd className="text-2xl font-bold text-amber-400">{figure.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* --- Movie rows --- */}
      {rows.map((row) => (
        <section key={row.category} className="mx-auto max-w-6xl px-4 py-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="mb-2">
                <CategoryBadge category={row.category} size="md" />
              </div>
              <h2 className="text-2xl font-bold">{row.title}</h2>
              <p className="text-sm text-muted">{CATEGORIES[row.category].rule}</p>
            </div>
            <Link href={`/hype-check?category=${row.category}`} className="text-sm text-amber-400 hover:text-amber-300">
              See all ({stats.categories[row.category]}) →
            </Link>
          </div>
          <MovieRow movies={row.movies} />
        </section>
      ))}
    </div>
  );
}
