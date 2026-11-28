import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { setGift } from "@/lib/subscribers";

export const runtime = "nodejs";

/** Subscribers (/admin/subscribers): choose which product is the free download. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 2_000);
    if (body.action !== "gift") throw new HttpError(400, "Unknown action.");
    return Response.json({ ok: true, ...await setGift(body.productId, storeId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
