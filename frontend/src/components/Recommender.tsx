"use client";
/* eslint-disable @next/next/no-img-element -- posters served already resized by the TMDB CDN */

import { useEffect, useMemo, useState } from "react";
import { posterUrl } from "@/lib/data";
import {
  ALL_GENRES,
  buildPeopleIndex,
  emptyMember,
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
  onChange,
}: {
  catalog: RecoMovie[];
  people: Person[];
  member: Member;
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
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-amber-400"
      />
      {movies.length + persons.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-xl">
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
      <span aria-hidden>{TASTE_STYLES[kind].icon}</span>
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
  canRemove,
  onChange,
  onRemove,
}: {
  member: Member;
  index: number;
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
  const isEmpty = member.likes.length + member.directors.length + member.actors.length + member.genres.length === 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
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
      <TasteSearch catalog={catalog} people={people} member={member} onChange={onChange} />

      <div className="mt-3 flex flex-wrap gap-2">
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
        {isEmpty && <span className="text-xs text-muted">Add movies, directors, actors or genres you love.</span>}
      </div>

      <button
        type="button"
        onClick={() => setShowGenres(!showGenres)}
        className="mt-3 text-xs text-amber-400 hover:text-amber-300"
      >
        {showGenres ? "Hide genres" : "+ Favorite genres"}
      </button>
      {showGenres && (
        <div className="mt-2 flex flex-wrap gap-1.5">
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

export function Recommender() {
  const [catalog, setCatalog] = useState<RecoMovie[] | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"solo" | "group">("solo");
  const [members, setMembers] = useState<Member[]>([emptyMember("Me")]);
  const [constraints, setConstraints] = useState<Constraints>({ genres: [], maxRuntime: null });
  const [strategy, setStrategy] = useState<Strategy>("least_misery");

  useEffect(() => {
    fetch("/api/reco-catalog")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then(setCatalog)
      .catch(() => setError(true));
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

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
      {/* --- Inputs --- */}
      <div className="space-y-5">
        <div className="flex rounded-lg border border-border p-1 text-sm">
          {(["solo", "group"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => switchMode(value)}
              className={`flex-1 rounded-md px-3 py-2 font-medium transition ${
                mode === value ? "bg-amber-400 text-black" : "text-muted hover:text-foreground"
              }`}
            >
              {value === "solo" ? "Just me" : "A group"}
            </button>
          ))}
        </div>

        {activeMembers.map((member, index) => (
          <MemberCard
            key={index}
            member={member}
            index={index}
            catalog={catalog}
            people={people}
            genres={genres}
            byId={byId}
            canRemove={mode === "group" && members.length > 2}
            onChange={(updated) => setMembers(members.map((m, i) => (i === index ? updated : m)))}
            onRemove={() => setMembers(members.filter((_, i) => i !== index))}
          />
        ))}

        <div className="flex flex-wrap gap-3 text-sm">
          {mode === "group" && members.length < 5 && (
            <button
              type="button"
              onClick={() => setMembers([...members, emptyMember(`Friend ${members.length}`)])}
              className="rounded-lg border border-border px-3 py-2 hover:bg-surface"
            >
              + Add a member
            </button>
          )}
          <button type="button" onClick={loadExample} className="rounded-lg border border-border px-3 py-2 hover:bg-surface">
            Try an example
          </button>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="font-semibold">Tonight</p>
          <select
            value={constraints.maxRuntime ?? ""}
            onChange={(event) =>
              setConstraints({ ...constraints, maxRuntime: event.target.value ? Number(event.target.value) : null })
            }
            aria-label="Maximum runtime"
            className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-amber-400"
          >
            {RUNTIMES.map((runtime) => (
              <option key={runtime.label} value={runtime.value ?? ""}>
                {runtime.label}
              </option>
            ))}
          </select>
          <p className="mt-4 text-xs text-muted">In the mood for…</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {genres.map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => toggleGenre(genre)}
                className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition ${
                  constraints.genres.includes(genre)
                    ? "bg-amber-400 text-black ring-amber-400"
                    : "text-muted ring-border hover:text-foreground"
                }`}
              >
                {genre}
              </button>
            ))}
          </div>
        </div>

        {mode === "group" && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="font-semibold">Group strategy</p>
            <div className="mt-3 space-y-2">
              {(Object.keys(STRATEGIES) as Strategy[]).map((key) => (
                <label key={key} className="flex cursor-pointer gap-3 text-sm">
                  <input
                    type="radio"
                    name="strategy"
                    checked={strategy === key}
                    onChange={() => setStrategy(key)}
                    className="mt-1 accent-amber-400"
                  />
                  <span>
                    <span className="font-medium">{STRATEGIES[key].label}</span>
                    <span className="block text-muted">{STRATEGIES[key].description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* --- Results --- */}
      <div>
        {results.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-muted">
            <p className="text-4xl">🍿</p>
            <p className="mt-3 max-w-sm">
              Add movies, directors, actors or genres you love{mode === "group" ? " for each member" : ""}, and
              recommendations will appear here, each with its explanation.
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {results.map((result, rank) => (
              <li key={result.movie.id} className="flex gap-4 rounded-xl border border-border bg-surface p-3">
                {result.movie.poster ? (
                  <img
                    src={posterUrl(result.movie.poster)!}
                    alt={`Poster of ${result.movie.title}`}
                    loading="lazy"
                    className="h-36 w-24 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-36 w-24 shrink-0 rounded-lg bg-background" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">
                      <span className="text-muted">{rank + 1}.</span> {result.movie.title}
                    </h3>
                    <span className="shrink-0 rounded-md bg-amber-400 px-2 py-0.5 text-sm font-bold text-black">
                      {Math.round(result.score * 100)}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {[
                      result.movie.year,
                      result.movie.runtime ? `${result.movie.runtime} min` : null,
                      result.movie.genres.slice(0, 3).join(", "),
                      result.movie.directors[0] ? `by ${result.movie.directors[0]}` : null,
                      result.movie.rating != null ? `★ ${result.movie.rating.toFixed(1)} IMDb` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {result.members.map((member, m) => (
                      <li key={m} className="flex items-start gap-2">
                        {result.members.length > 1 && (
                          <span className="mt-1 flex w-28 shrink-0 items-center gap-1.5 text-xs">
                            <span className={`h-2 w-2 rounded-full ${MEMBER_COLORS[m % MEMBER_COLORS.length]}`} />
                            <span className="truncate">{member.name}</span>
                            <span className="text-muted">{Math.round(member.score * 100)}%</span>
                          </span>
                        )}
                        <span className="text-muted">
                          {member.reasons[0] ?? "A well-rated movie close to your tastes"}
                          {member.reasons[1] && <span className="hidden sm:inline"> · {member.reasons[1]}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
