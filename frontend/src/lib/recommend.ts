// Hybrid, explainable recommender. Runs in the browser on the catalog prepared by the pipeline:
// - content-based: genres, directors, main cast and runtime, from the movies a person loves
//   and from the genres, directors and actors they pick explicitly
// - collaborative: item-item similarity computed from MovieLens ratings (cinematch.recommendation)
// - quality prior: IMDb rating
// For a group, each member is scored separately, then combined with a group strategy.

export type RecoMovie = {
  id: number;
  title: string;
  year: number | null;
  runtime: number | null;
  poster: string | null;
  rating: number | null;
  votes: number | null;
  popularity: number; // number of MovieLens ratings
  genres: string[];
  directors: string[];
  cast: string[];
  neighbors: [number, number][]; // [tmdb_id, similarity], most similar first
};

// A member's tastes: movies they love, and genres, directors and actors they like
export type Member = { name: string; likes: number[]; genres: string[]; directors: string[]; actors: string[] };

export const emptyMember = (name: string): Member => ({ name, likes: [], genres: [], directors: [], actors: [] });

export const hasTastes = (member: Member) =>
  member.likes.length + member.genres.length + member.directors.length + member.actors.length > 0;

export type Constraints = { genres: string[]; maxRuntime: number | null };

export type Strategy = "average" | "least_misery";

export const STRATEGIES: Record<Strategy, { label: string; description: string }> = {
  average: {
    label: "Average",
    description: "The movie the group likes most on average.",
  },
  least_misery: {
    label: "Least misery",
    description: "The movie whose least happy member is as happy as possible: nobody is left out.",
  },
};

// Weights of the hybrid score (content, collaborative, quality)
const WEIGHTS = { content: 0.4, collaborative: 0.4, quality: 0.2 };
const CONTENT_WEIGHTS = { genres: 0.5, directors: 0.3, cast: 0.2 };
const GENRE_BOOST = 0.15; // bonus when a movie matches a genre chosen for tonight

type MemberScore = { score: number; reasons: string[] };

export type Recommendation = {
  movie: RecoMovie;
  score: number; // 0..1, combined for the group
  members: (MemberScore & { name: string })[];
};

// Where a taste comes from: a loved movie, or an explicit choice (null)
type Source = RecoMovie | null;

type Profile = {
  liked: RecoMovie[];
  genreWeights: Map<string, number>; // 1 for a favorite genre, else share of the loved movies having it
  favoriteGenres: Set<string>;
  directors: Map<string, Source>;
  actors: Map<string, Source>;
  similarity: Map<number, { score: number; from: RecoMovie }>; // best collaborative similarity to a loved movie
};

function buildProfile(member: Member, byId: Map<number, RecoMovie>): Profile {
  const liked = member.likes.map((id) => byId.get(id)).filter((m): m is RecoMovie => Boolean(m));
  const genreWeights = new Map<string, number>();
  const directors = new Map<string, Source>();
  const actors = new Map<string, Source>();
  const similarity = new Map<number, { score: number; from: RecoMovie }>();
  for (const movie of liked) {
    for (const genre of movie.genres) genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + 1 / liked.length);
    for (const name of movie.directors) directors.set(name, movie);
    for (const name of movie.cast) actors.set(name, movie);
    for (const [id, score] of movie.neighbors) {
      if (score > (similarity.get(id)?.score ?? 0)) similarity.set(id, { score, from: movie });
    }
  }
  // Explicit choices weigh as much as the strongest signal from loved movies
  for (const genre of member.genres) genreWeights.set(genre, 1);
  for (const name of member.directors) directors.set(name, null);
  for (const name of member.actors) actors.set(name, null);
  return { liked, genreWeights, favoriteGenres: new Set(member.genres), directors, actors, similarity };
}

function scoreForMember(movie: RecoMovie, profile: Profile): MemberScore {
  const reasons: { text: string; weight: number }[] = [];

  // Content: genres in common, same director, same actors
  const genreMatch = movie.genres.reduce((sum, genre) => sum + (profile.genreWeights.get(genre) ?? 0), 0);
  const genreScore = Math.min(1, genreMatch / 1.5);
  const director = movie.directors.find((name) => profile.directors.has(name));
  const actors = movie.cast.filter((name) => profile.actors.has(name));
  const content =
    CONTENT_WEIGHTS.genres * genreScore +
    CONTENT_WEIGHTS.directors * (director ? 1 : 0) +
    CONTENT_WEIGHTS.cast * Math.min(1, actors.length / 2);

  // Collaborative: similarity to the closest loved movie (scores rarely exceed 0.5)
  const closest = profile.similarity.get(movie.id);
  const collaborative = closest ? Math.min(1, closest.score / 0.5) : 0;

  // Quality prior: IMDb rating from 5/10 (0) to 9/10 (1)
  const quality = movie.rating != null ? Math.min(1, Math.max(0, (movie.rating - 5) / 4)) : 0.3;

  if (closest && collaborative > 0.2) {
    reasons.push({ text: `Viewers who loved ${closest.from.title} also loved it`, weight: collaborative });
  }
  if (director) {
    const from = profile.directors.get(director);
    const text = from ? `Directed by ${director}, like ${from.title}` : `Directed by ${director}, one of your favorites`;
    reasons.push({ text, weight: 0.9 });
  }
  if (actors.length > 0) {
    const from = profile.actors.get(actors[0]);
    const names = actors.slice(0, 2).join(" and ");
    const text = from ? `With ${actors[0]}, as in ${from.title}` : `With ${names}, among your favorite actors`;
    reasons.push({ text, weight: 0.7 + 0.1 * actors.length });
  }
  const favorite = movie.genres.filter((genre) => profile.favoriteGenres.has(genre));
  if (favorite.length > 0) {
    const genres = favorite.slice(0, 2).join(" and ").toLowerCase();
    const article = /^[aeiou]/.test(genres) ? "An" : "A";
    reasons.push({ text: `${article} ${genres} movie, as you like`, weight: 0.5 });
  } else if (genreScore >= 0.5) {
    const shared = movie.genres.filter((g) => profile.genreWeights.has(g)).slice(0, 2);
    reasons.push({ text: `Matches your taste for ${shared.join(" and ").toLowerCase()}`, weight: genreScore * 0.5 });
  }

  // Without any loved movie, the collaborative part cannot apply: its weight goes to the content
  const contentWeight = profile.liked.length > 0 ? WEIGHTS.content : WEIGHTS.content + WEIGHTS.collaborative;
  const score = contentWeight * content + WEIGHTS.collaborative * collaborative + WEIGHTS.quality * quality;
  return { score, reasons: reasons.sort((a, b) => b.weight - a.weight).map((r) => r.text) };
}

export function recommend(
  catalog: RecoMovie[],
  members: Member[],
  constraints: Constraints,
  strategy: Strategy,
  limit = 12,
): Recommendation[] {
  const byId = new Map(catalog.map((movie) => [movie.id, movie]));
  const active = members.filter(hasTastes);
  if (active.length === 0) return [];
  const profiles = active.map((member) => buildProfile(member, byId));
  const alreadyLiked = new Set(active.flatMap((member) => member.likes));

  const candidates = catalog.filter(
    (movie) =>
      !alreadyLiked.has(movie.id) &&
      (constraints.maxRuntime == null || (movie.runtime != null && movie.runtime <= constraints.maxRuntime)),
  );

  // Raw scores per member, then normalized by each member's best score: everyone counts the same
  const raw = profiles.map((profile) => candidates.map((movie) => scoreForMember(movie, profile)));
  const best = raw.map((scores) => Math.max(...scores.map((s) => s.score), 1e-9));

  const results = candidates.map((movie, index) => {
    const boost = constraints.genres.some((g) => movie.genres.includes(g)) ? GENRE_BOOST : 0;
    const perMember = active.map((member, m) => ({
      name: member.name,
      score: Math.min(1, raw[m][index].score / best[m] + boost),
      reasons: raw[m][index].reasons,
    }));
    const values = perMember.map((p) => p.score);
    const score =
      strategy === "least_misery" ? Math.min(...values) : values.reduce((sum, v) => sum + v, 0) / values.length;
    return { movie, score, members: perMember };
  });

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// --- Search: movies, directors and actors a visitor can add to their tastes ---

export type Person = { name: string; role: "director" | "actor"; movies: number };

// Every director and actor of the catalog, with their number of movies (most prolific first)
export function buildPeopleIndex(catalog: RecoMovie[]): Person[] {
  const counts = new Map<string, Person>();
  for (const movie of catalog) {
    for (const [names, role] of [
      [movie.directors, "director"],
      [movie.cast, "actor"],
    ] as const) {
      for (const name of names) {
        const key = `${role}:${name}`;
        const person = counts.get(key) ?? { name, role, movies: 0 };
        person.movies += 1;
        counts.set(key, person);
      }
    }
  }
  return [...counts.values()].sort((a, b) => b.movies - a.movies);
}

export function searchCatalog(catalog: RecoMovie[], query: string, exclude: number[], limit = 6): RecoMovie[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return catalog.filter((movie) => !exclude.includes(movie.id) && movie.title.toLowerCase().includes(q)).slice(0, limit);
}

export function searchPeople(people: Person[], query: string, member: Member, limit = 6): Person[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return people
    .filter(
      (person) =>
        person.name.toLowerCase().includes(q) &&
        !(person.role === "director" ? member.directors : member.actors).includes(person.name),
    )
    .slice(0, limit);
}

export const ALL_GENRES = (catalog: RecoMovie[]) => [...new Set(catalog.flatMap((movie) => movie.genres))].sort();
