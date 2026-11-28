import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { markChecked, saveVariantCost } from "@/lib/margins";

export const runtime = "nodejs";

/** Margins (/admin/margins): save a variant's costs, or record that its supplier price was checked. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 2_000);
    let result: unknown;
    switch (body.action) {
      case "cost": result = await saveVariantCost(body, storeId); break;
      case "checked": result = await markChecked(body, storeId); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
