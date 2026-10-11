// Called by the Airflow task publish_serving right after it publishes new data:
// the cached pages are refreshed immediately instead of waiting for the hourly revalidation.
import { revalidateTag } from "next/cache";
import { SERVING_TAG } from "@/lib/queries";

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // expire: 0 → the next visit gets fresh data, never the previous day's
  revalidateTag(SERVING_TAG, { expire: 0 });
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
