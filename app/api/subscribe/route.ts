import { apiError, jsonObject, sameOrigin } from "@/lib/http";
import { subscribe } from "@/lib/subscribers";

export const runtime = "nodejs";

/** The free download form: emails the download link and, if ticked, joins the marketing list. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = await jsonObject(req, 2_000);
    return Response.json(await subscribe(body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
