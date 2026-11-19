import { requireOwner } from "@/lib/auth";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { markChecked, saveVariantCost } from "@/lib/margins";

export const runtime = "nodejs";

/** Margins (/admin/margins): save a variant's costs, or record that its supplier price was checked. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await requireOwner();
    const body = await jsonObject(req, 2_000);
    let result: unknown;
    switch (body.action) {
      case "cost": result = await saveVariantCost(body); break;
      case "checked": result = await markChecked(body); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
