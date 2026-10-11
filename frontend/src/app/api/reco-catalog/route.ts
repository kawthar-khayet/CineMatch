// Catalog used by the recommendation page: fetched once by the browser, which then computes
// recommendations instantly as the visitor picks movies (no round trip per click).
import { getRecoCatalog } from "@/lib/queries";

export async function GET() {
  return Response.json(await getRecoCatalog());
}
