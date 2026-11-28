import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { createDiscountCode, setDiscountCodeActive } from "@/lib/discount-codes";
import { setThankYouCode } from "@/lib/thank-you-offers";

export const runtime = "nodejs";

/** Discount codes (/admin/discounts): create one, or pause and resume it. Every action needs the owner. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 4_000);
    let result: unknown;
    switch (body.action) {
      case "create": result = { code: await createDiscountCode(body, storeId) }; break;
      case "active": result = { code: await setDiscountCodeActive(body, storeId) }; break;
      case "thank-you": result = await setThankYouCode(body.id, storeId); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ ok: true, ...(result as object) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
