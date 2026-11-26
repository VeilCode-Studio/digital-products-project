import { startCheckout } from "@/lib/checkout";
import { apiError, HttpError, jsonObject } from "@/lib/http";
import { shopperOrigin } from "@/lib/domains";
import { linkFromCookie } from "@/lib/short-links";

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const body = await jsonObject(req);
    if (typeof body.productId !== "string" || body.productId.length > 100 || typeof body.checkoutId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.checkoutId)) throw new HttpError(400, "Invalid checkout request.");
    await shopperOrigin(req, body.productId);
    const url = await startCheckout(body.productId, body.checkoutId, linkFromCookie(req.headers.get("cookie")));
    return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
