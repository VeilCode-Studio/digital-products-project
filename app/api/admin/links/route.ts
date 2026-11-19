import { requireOwner } from "@/lib/auth";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { createShortLink, deleteShortLink, updateShortLink } from "@/lib/short-links";

export const runtime = "nodejs";

/** Short links (/admin/links): create, update and delete. Every action needs the owner. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await requireOwner();
    const body = await jsonObject(req, 4_000);
    let result: unknown;
    switch (body.action) {
      case "create": result = { link: await createShortLink(body) }; break;
      case "update": result = { link: await updateShortLink(body) }; break;
      case "delete": result = await deleteShortLink(body); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ ok: true, ...(result as object) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
