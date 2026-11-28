import { apiError, HttpError, jsonObject } from "@/lib/http";
import { STORE_ID } from "@/lib/store-config";
import { STORE_UUID } from "@/lib/storefront-paths";
import { domainProduct, shopperOrigin } from "@/lib/domains";
import { subscribe } from "@/lib/subscribers";

export const runtime = "nodejs";

/** The free download form: emails the download link and, if ticked, joins the marketing list. */
export async function POST(req: Request) {
  try {
    await shopperOrigin(req);
    const body = await jsonObject(req, 2_000);
    const domain = await domainProduct(new URL(req.url).hostname);
    const storeId = domain?.store_id ?? body.storeId ?? STORE_ID;
    if (typeof storeId !== "string" || !STORE_UUID.test(storeId) || (domain && body.storeId && body.storeId !== domain.store_id)) throw new HttpError(400, "Invalid store.");
    return Response.json(await subscribe(body, storeId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
