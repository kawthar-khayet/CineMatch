import type { Metadata } from "next";
import { Recommender } from "@/components/Recommender";

export const metadata: Metadata = {
  title: "Recommendations",
  description:
    "Movie recommendations from your tastes (genres, directors, actors, runtime), for you or for a whole group, each with its explanation.",
};

export default function RecommendPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">What should we watch tonight?</h1>
      <p className="mt-3 max-w-3xl text-muted">
        Tell us what you love: movies, directors, actors or genres. CineMatch combines your tastes with what viewers
        like you also loved, and explains every recommendation. In a group, it finds the movie that works for everyone.
      </p>
      <div className="mt-8">
        <Recommender />
      </div>
    </div>
  );
}
