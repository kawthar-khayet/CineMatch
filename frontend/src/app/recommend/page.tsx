import type { Metadata } from "next";
import { Suspense } from "react";
import { Recommender } from "@/components/Recommender";

export const metadata: Metadata = {
  title: "Recommendations",
  description:
    "Movie recommendations from your tastes (genres, directors, actors, runtime), for you or for a whole group, each with its explanation.",
};

export default function RecommendPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">What should we watch tonight?</h1>
      <p className="mx-auto mt-4 max-w-xl text-center text-muted">
        Tell us what you love. CineMatch finds movies matched to your tastes, for you or for your whole group, and
        explains every pick.
      </p>
      <div className="mt-8">
        <Suspense>
          <Recommender />
        </Suspense>
      </div>
    </div>
  );
}
