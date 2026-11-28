import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { setReviewStatus } from "@/lib/reviews";

export const runtime = "nodejs";

/** Reviews (/admin/reviews): approve, hide or put back a review. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 2_000);
    if (body.action !== "status") throw new HttpError(400, "Unknown action.");
    return Response.json({ ok: true, review: await setReviewStatus(body, storeId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
