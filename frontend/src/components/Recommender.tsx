"use client";
/* eslint-disable @next/next/no-img-element -- posters served already resized by the TMDB CDN */

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { posterUrl } from "@/lib/data";
import {
  ALL_GENRES,
  buildPeopleIndex,
  emptyMember,
  hasTastes,
  recommend,
  searchCatalog,
  searchPeople,
  STRATEGIES,
  type Constraints,
  type Member,
  type Person,
  type RecoMovie,
  type Strategy,
} from "@/lib/recommend";

const RUNTIMES: { label: string; value: number | null }[] = [
  { label: "Any length", value: null },
  { label: "Under 1h30", value: 90 },
  { label: "Under 2h", value: 120 },
  { label: "Under 2h30", value: 150 },
];

// Example tastes, to try the recommender in one click (movie titles looked up in the catalog)
const EXAMPLES: { name: string; titles: string[]; genres: string[]; directors: string[]; actors: string[] }[] = [
  { name: "Me", titles: ["Inception", "Se7en"], genres: ["Thriller"], directors: ["Christopher Nolan"], actors: [] },
  {
    name: "My brother",
    titles: ["Toy Story", "Back to the Future"],
    genres: ["Comedy"],
    directors: [],
    actors: ["Tom Hanks"],
  },
];

const MEMBER_COLORS = ["bg-amber-400", "bg-sky-400", "bg-emerald-400", "bg-rose-400", "bg-violet-400"];

const TASTE_STYLES = {
  movie: { icon: "🎬", ring: "ring-border" },
  director: { icon: "🎥", ring: "ring-sky-500/40" },
  actor: { icon: "⭐", ring: "ring-amber-500/40" },
  genre: { icon: "🏷️", ring: "ring-emerald-500/40" },
};

// One search box for everything a member can like: movies, directors and actors
function TasteSearch({
  catalog,
  people,
  member,
  large,
  onChange,
}: {
  catalog: RecoMovie[];
  people: Person[];
  member: Member;
  large: boolean;
  onChange: (member: Member) => void;
}) {
  const [query, setQuery] = useState("");
  const movies = useMemo(() => searchCatalog(catalog, query, member.likes), [catalog, query, member.likes]);
  const persons = useMemo(() => searchPeople(people, query, member), [people, query, member]);
  const pick = (updated: Member) => {
    onChange(updated);
    setQuery("");
  };
  const item = "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-background";
  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="A movie, director or actor you love…"
        className={`w-full rounded-lg border border-border bg-surface outline-none placeholder:text-muted focus:border-amber-400 ${
          large ? "px-5 py-4 text-lg" : "px-3 py-2 text-sm"
        }`}
      />
      {movies.length + persons.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-surface text-left shadow-xl">
          {movies.map((movie) => (
            <li key={`movie-${movie.id}`}>
              <button
                type="button"
                onClick={() => pick({ ...member, likes: [...member.likes, movie.id] })}
                className={item}
              >
                {movie.poster ? (
                  <img src={posterUrl(movie.poster)!} alt="" className="h-12 w-8 rounded object-cover" />
                ) : (
                  <span className="h-12 w-8 rounded bg-background" />
                )}
                <span>
                  {movie.title} <span className="text-muted">{movie.year}</span>
                </span>
              </button>
            </li>
          ))}
          {persons.map((person) => (
            <li key={`${person.role}-${person.name}`}>
              <button
                type="button"
                onClick={() =>
                  pick(
                    person.role === "director"
                      ? { ...member, directors: [...member.directors, person.name] }
                      : { ...member, actors: [...member.actors, person.name] },
                  )
                }
                className={item}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background">
                  {TASTE_STYLES[person.role].icon}
                </span>
                <span>
                  {person.name}{" "}
                  <span className="text-muted">
                    {person.role} · {person.movies} movie{person.movies > 1 ? "s" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TasteChip({
  kind,
  label,
  onRemove,
}: {
  kind: keyof typeof TASTE_STYLES;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-background px-3 py-1 text-xs ring-1 ${TASTE_STYLES[kind].ring}`}
    >
      {label}
      <button type="button" onClick={onRemove} className="text-muted hover:text-foreground" aria-label={`Remove ${label}`}>
        ✕
      </button>
    </span>
  );
}

function MemberCard({
  member,
  index,
  catalog,
  people,
  genres,
  byId,
  solo,
  canRemove,
  onChange,
  onRemove,
}: {
  member: Member;
  index: number;
  solo: boolean;
  catalog: RecoMovie[];
  people: Person[];
  genres: string[];
  byId: Map<number, RecoMovie>;
  canRemove: boolean;
  onChange: (member: Member) => void;
  onRemove: () => void;
}) {
  const [showGenres, setShowGenres] = useState(false);
  const without = (list: string[], value: string) => list.filter((item) => item !== value);
  const isEmpty = !hasTastes(member);
  const centered = solo ? "justify-center" : "";
  return (
    <div className={solo ? "" : "py-5"}>
      {/* Alone, there is nobody to tell apart: no name, just one large search box */}
      {!solo && (
        <div className="mb-3 flex items-center gap-2">
          <span className={`h-3 w-3 shrink-0 rounded-full ${MEMBER_COLORS[index % MEMBER_COLORS.length]}`} />
          <input
            value={member.name}
            onChange={(event) => onChange({ ...member, name: event.target.value })}
            aria-label="Member name"
            className="w-full bg-transparent font-semibold outline-none"
          />
          {canRemove && (
            <button type="button" onClick={onRemove} className="text-sm text-muted hover:text-red-300" aria-label="Remove">
              ✕
            </button>
          )}
        </div>
      )}
      <TasteSearch catalog={catalog} people={people} member={member} large={solo} onChange={onChange} />

      <div className={`mt-3 flex flex-wrap gap-2 ${centered}`}>
        {member.likes.map((id) => (
          <TasteChip
            key={`m${id}`}
            kind="movie"
            label={byId.get(id)?.title ?? String(id)}
            onRemove={() => onChange({ ...member, likes: member.likes.filter((like) => like !== id) })}
          />
        ))}
        {member.directors.map((name) => (
          <TasteChip
            key={`d${name}`}
            kind="director"
            label={name}
            onRemove={() => onChange({ ...member, directors: without(member.directors, name) })}
          />
        ))}
        {member.actors.map((name) => (
          <TasteChip
            key={`a${name}`}
            kind="actor"
            label={name}
            onRemove={() => onChange({ ...member, actors: without(member.actors, name) })}
          />
        ))}
        {member.genres.map((genre) => (
          <TasteChip
            key={`g${genre}`}
            kind="genre"
            label={genre}
            onRemove={() => onChange({ ...member, genres: without(member.genres, genre) })}
          />
        ))}
        {isEmpty && !solo && (
          <span className="text-xs text-muted">Add movies, directors, actors or genres they love.</span>
        )}
        <button
          type="button"
          onClick={() => setShowGenres(!showGenres)}
          className="px-1 py-1 text-xs text-amber-400 hover:text-amber-300"
        >
          {showGenres ? "Hide genres" : "+ Favorite genres"}
        </button>
      </div>
      {showGenres && (
        <div className={`mt-2 flex flex-wrap gap-1.5 ${centered}`}>
          {genres.map((genre) => {
            const active = member.genres.includes(genre);
            return (
              <button
                key={genre}
                type="button"
                onClick={() =>
                  onChange({ ...member, genres: active ? without(member.genres, genre) : [...member.genres, genre] })
                }
                className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition ${
                  active ? "bg-emerald-400 text-black ring-emerald-400" : "text-muted ring-border hover:text-foreground"
                }`}
              >
                {genre}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tastes sent by a movie page ("More like this"): the movie itself when the catalog has it,
// otherwise its genres and directors (recent trending movies are not in the catalog yet)
function tastesFromUrl(params: URLSearchParams, catalog: RecoMovie[]): { member: Member; note: string } | null {
  const like = Number(params.get("like"));
  if (!like) return null;
  const member = emptyMember("Me");
  const title = params.get("title") ?? "this movie";
  if (catalog.some((movie) => movie.id === like)) {
    return { member: { ...member, likes: [like] }, note: `Based on ${title}.` };
  }
  const list = (key: string) => params.get(key)?.split("|").filter(Boolean) ?? [];
  const genres = list("genres").filter((genre) => catalog.some((movie) => movie.genres.includes(genre)));
  const directors = list("directors").filter((name) => catalog.some((movie) => movie.directors.includes(name)));
  if (genres.length + directors.length === 0) return null;
  const basis = [genres.length > 0 ? "genres" : null, directors.length > 0 ? "director" : null].filter(Boolean);
  return {
    member: { ...member, genres, directors },
    note: `${title} is too recent to be in our catalog, so these picks are based on its ${basis.join(" and ")}.`,
  };
}

export function Recommender() {
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<RecoMovie[] | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"solo" | "group">("solo");
  const [members, setMembers] = useState<Member[]>([emptyMember("Me")]);
  const [constraints, setConstraints] = useState<Constraints>({ genres: [], maxRuntime: null });
  const [strategy, setStrategy] = useState<Strategy>("least_misery");
  const [urlNote, setUrlNote] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/reco-catalog")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((loaded: RecoMovie[]) => {
        setCatalog(loaded);
        const fromUrl = tastesFromUrl(params, loaded);
        if (fromUrl) {
          setMembers([fromUrl.member]);
          setUrlNote(fromUrl.note);
        }
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the URL tastes are applied once, when the catalog loads
  }, []);

  const byId = useMemo(() => new Map((catalog ?? []).map((movie) => [movie.id, movie])), [catalog]);
  const genres = useMemo(() => (catalog ? ALL_GENRES(catalog) : []), [catalog]);
  const people = useMemo(() => (catalog ? buildPeopleIndex(catalog) : []), [catalog]);
  const activeMembers = mode === "solo" ? members.slice(0, 1) : members;
  const results = useMemo(
    () => (catalog ? recommend(catalog, activeMembers, constraints, strategy) : []),
    [catalog, activeMembers, constraints, strategy],
  );

  const switchMode = (next: "solo" | "group") => {
    setMode(next);
    if (next === "group" && members.length < 2) setMembers([...members, emptyMember("Friend")]);
  };

  const loadExample = () => {
    if (!catalog) return;
    const find = (title: string) => catalog.find((movie) => movie.title === title)?.id;
    const examples = (mode === "solo" ? EXAMPLES.slice(0, 1) : EXAMPLES).map(({ titles, ...tastes }) => ({
      ...tastes,
      likes: titles.map(find).filter((id): id is number => id != null),
    }));
    setMembers(examples);
  };

  if (error) return <p className="text-red-300">The catalog could not be loaded. Please try again later.</p>;
  if (!catalog) return <p className="text-muted">Loading the catalog…</p>;

  const toggleGenre = (genre: string) =>
    setConstraints({
      ...constraints,
      genres: constraints.genres.includes(genre)
        ? constraints.genres.filter((g) => g !== genre)
        : [...constraints.genres, genre],
    });

  const solo = mode === "solo";
  const pill = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition ${
      active ? "bg-amber-400 font-medium text-black ring-amber-400" : "text-muted ring-border hover:text-foreground"
    }`;
  // Popular movies to click on, so that nobody has to start from an empty search box
  const starters = solo && !hasTastes(members[0]) ? catalog.filter((movie) => movie.poster).slice(0, 8) : [];

  return (
    <div className="space-y-8">
      {/* --- Tastes --- */}
      <div className={solo ? "mx-auto max-w-2xl text-center" : "mx-auto max-w-2xl divide-y divide-border"}>
        {activeMembers.map((member, index) => (
          <MemberCard
            key={index}
            member={member}
            index={index}
            catalog={catalog}
            people={people}
            genres={genres}
            byId={byId}
            solo={solo}
            canRemove={!solo && members.length > 2}
            onChange={(updated) => setMembers(members.map((m, i) => (i === index ? updated : m)))}
            onRemove={() => setMembers(members.filter((_, i) => i !== index))}
          />
        ))}
        {urlNote && <p className="pt-3 text-sm text-muted">{urlNote}</p>}
      </div>

      {starters.length > 0 && (
        <div>
          <p className="mb-3 text-center text-sm text-muted">Or start with a favorite</p>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {starters.map((movie) => (
              <button
                key={movie.id}
                type="button"
                onClick={() => setMembers([{ ...members[0], likes: [movie.id] }, ...members.slice(1)])}
                className="overflow-hidden rounded-lg ring-1 ring-border transition hover:ring-amber-400"
                aria-label={`I love ${movie.title}`}
              >
                <img src={posterUrl(movie.poster)!} alt="" className="aspect-[2/3] w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* --- Who is watching, and tonight's constraints: one labelled row per setting --- */}
      <dl className="grid grid-cols-[4.5rem_1fr] items-baseline gap-x-4 gap-y-3 border-y border-border py-4 text-xs">
        <dt className="text-muted">Watching</dt>
        <dd className="flex flex-wrap items-center gap-1.5">
          {(["solo", "group"] as const).map((value) => (
            <button key={value} type="button" onClick={() => switchMode(value)} className={pill(mode === value)}>
              {value === "solo" ? "Just me" : "A group"}
            </button>
          ))}
          {!solo && members.length < 5 && (
            <button
              type="button"
              onClick={() => setMembers([...members, emptyMember(`Friend ${members.length}`)])}
              className="px-2 text-amber-400 hover:text-amber-300"
            >
              + Add a member
            </button>
          )}
          <button type="button" onClick={loadExample} className="ml-auto px-2 text-amber-400 hover:text-amber-300">
            Try an example
          </button>
        </dd>

        <dt className="text-muted">Length</dt>
        <dd className="flex flex-wrap gap-1.5">
          {RUNTIMES.map((runtime) => (
            <button
              key={runtime.label}
              type="button"
              onClick={() => setConstraints({ ...constraints, maxRuntime: runtime.value })}
              className={pill(constraints.maxRuntime === runtime.value)}
            >
              {runtime.label}
            </button>
          ))}
        </dd>

        <dt className="text-muted">Mood</dt>
        <dd className="flex flex-wrap gap-1.5">
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => toggleGenre(genre)}
              className={pill(constraints.genres.includes(genre))}
            >
              {genre}
            </button>
          ))}
        </dd>

        {!solo && (
          <>
            <dt className="text-muted">Strategy</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {(Object.keys(STRATEGIES) as Strategy[]).map((key) => (
                <button key={key} type="button" onClick={() => setStrategy(key)} className={pill(strategy === key)}>
                  {STRATEGIES[key].label}
                </button>
              ))}
              <span className="ml-2 text-muted">{STRATEGIES[strategy].description}</span>
            </dd>
          </>
        )}
      </dl>

      {/* --- Results --- */}
      {results.length === 0 ? (
        !solo && (
          <p className="text-center text-sm text-muted">
            Add what each member loves, and the movies that work for everyone will appear here.
          </p>
        )
      ) : (
        <ol className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
          {results.map((result, rank) => (
            <li key={result.movie.id}>
              <a
                href={`https://www.themoviedb.org/movie/${result.movie.id}`}
                target="_blank"
                rel="noreferrer"
                className="group block"
              >
                <div className="relative overflow-hidden rounded-lg ring-1 ring-border transition group-hover:ring-amber-400/60">
                  {result.movie.poster ? (
                    <img
                      src={posterUrl(result.movie.poster)!}
                      alt={`Poster of ${result.movie.title}`}
                      loading="lazy"
                      className="aspect-[2/3] w-full object-cover"
                    />
                  ) : (
                    <div className="aspect-[2/3] w-full bg-surface" />
                  )}
                  <span className="absolute right-2 top-2 rounded-md bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-black">
                    {Math.round(result.score * 100)}%
                  </span>
                </div>
                <h3 className="mt-2 text-sm font-medium leading-snug group-hover:text-amber-300">
                  <span className="text-muted">{rank + 1}.</span> {result.movie.title}
                </h3>
              </a>
              <p className="mt-0.5 text-xs text-muted">
                {[
                  result.movie.year,
                  result.movie.runtime ? `${result.movie.runtime} min` : null,
                  result.movie.rating != null ? `★ ${result.movie.rating.toFixed(1)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted">
                {result.members.map((member, m) => (
                  <li key={m}>
                    {result.members.length > 1 && (
                      <span className="flex items-center gap-1 text-foreground">
                        <span className={`h-2 w-2 rounded-full ${MEMBER_COLORS[m % MEMBER_COLORS.length]}`} />
                        {member.name} {Math.round(member.score * 100)}%
                      </span>
                    )}
                    {member.reasons[0] ?? "A well-rated movie close to your tastes"}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
