import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { createShortLink, deleteShortLink, updateShortLink } from "@/lib/short-links";

export const runtime = "nodejs";

/** Short links (/admin/links): create, update and delete. Every action needs the owner. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 4_000);
    let result: unknown;
    switch (body.action) {
      case "create": result = { link: await createShortLink(body, storeId) }; break;
      case "update": result = { link: await updateShortLink(body, storeId) }; break;
      case "delete": result = await deleteShortLink(body, storeId); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ ok: true, ...(result as object) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
