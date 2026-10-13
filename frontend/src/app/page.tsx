import Link from "next/link";
import { CategoryBadge } from "@/components/CategoryBadge";
import { MovieRow } from "@/components/MovieCard";
import { CATEGORIES, formatNumber, moviesIn, type Category } from "@/lib/data";
import { getMovies, getStats } from "@/lib/queries";

const SECTIONS: { category: Category; title: string }[] = [
  { category: "vraie_tendance", title: "The hype is deserved" },
  { category: "pepite_cachee", title: "Gems nobody is watching" },
  { category: "buzz_trompeur", title: "More hype than quality" },
];

const STEPS = [
  { title: "Tell us what you love", detail: "Movies, directors, actors or genres." },
  { title: "Alone or as a group", detail: "One movie that works for everyone." },
  { title: "Get explained picks", detail: "Every recommendation says why." },
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
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Is it a <span className="text-orange-400">true trend</span>, a{" "}
            <span className="text-sky-400">hidden gem</span>, or the{" "}
            <span className="text-amber-400">right movie for you</span> tonight?
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Streaming platforms recommend what is already popular, without telling you whether the hype is deserved.
            Every day, CineMatch crosses <strong className="text-foreground">TMDB trends</strong> with{" "}
            <strong className="text-foreground">IMDb ratings</strong> to tell you, movie by movie, and{" "}
            <strong className="text-foreground">recommends movies</strong> matched to your tastes.
          </p>

          {/* First door: the Hype Check */}
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <Link
              href="/hype-check"
              className="rounded-lg bg-amber-400 px-5 py-2.5 font-semibold text-black transition hover:bg-amber-300"
            >
              Run the Hype Check
            </Link>
            <p className="text-sm text-muted">Today&apos;s trends, checked against IMDb ratings.</p>
          </div>
        </div>
      </section>

      {/* --- Second door: recommendations --- */}
      <section className="border-b border-border bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-amber-400">Recommendations</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Not sure what to watch tonight?</h2>
            <p className="mt-4 max-w-md text-muted">
              Tell CineMatch what you love and get picks matched to your tastes, for you or for your whole group.
            </p>
            <Link
              href="/recommend"
              className="mt-6 inline-block rounded-lg bg-amber-400 px-5 py-2.5 font-semibold text-black transition hover:bg-amber-300"
            >
              Find my movie
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {STEPS.map((step) => (
              <li key={step.title} className="py-4">
                <span className="font-medium">{step.title}</span>
                <span className="block text-sm text-muted">{step.detail}</span>
              </li>
            ))}
          </ul>
        </div>
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
    </div>
  );
}
