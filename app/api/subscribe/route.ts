import { apiError, jsonObject } from "@/lib/http";
import { shopperOrigin } from "@/lib/domains";
import { subscribe } from "@/lib/subscribers";

export const runtime = "nodejs";

/** The free download form: emails the download link and, if ticked, joins the marketing list. */
export async function POST(req: Request) {
  try {
    await shopperOrigin(req);
    const body = await jsonObject(req, 2_000);
    return Response.json(await subscribe(body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
