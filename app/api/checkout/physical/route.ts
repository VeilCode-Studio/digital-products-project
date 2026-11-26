import { startPhysicalCheckout, MAX_QUANTITY } from "@/lib/physical-checkout";
import { apiError, HttpError, jsonObject } from "@/lib/http";
import { shopperOrigin } from "@/lib/domains";
import { attributionFrom } from "@/lib/tiktok";
import { linkFromCookie } from "@/lib/short-links";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The browser names the product, variant and quantity; every price and shipping amount is loaded server-side.
export async function POST(req: Request) {
  try {
    const body = await jsonObject(req);
    const { productId, variantId, quantity, checkoutId } = body;
    if (typeof productId !== "string" || productId.length > 100 || typeof variantId !== "string" || !UUID.test(variantId) ||
        typeof checkoutId !== "string" || !UUID_V4.test(checkoutId) ||
        typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HttpError(400, "Invalid checkout request.");
    }
    await shopperOrigin(req, productId);
    const url = await startPhysicalCheckout({ productId, variantId, quantity, checkoutId, attribution: attributionFrom(req), linkSlug: linkFromCookie(req.headers.get("cookie")) });
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
