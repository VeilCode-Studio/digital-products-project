import { apiError, jsonObject, sameOrigin } from "@/lib/http";
import { submitReview } from "@/lib/reviews";

export const runtime = "nodejs";

/** A buyer's review, from the link in their review request email. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    return Response.json(await submitReview(await jsonObject(req, 6_000)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
