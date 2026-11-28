import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { createStore, duplicateStore, saveStore, saveStorePreview } from "@/lib/manage-stores";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A full store save (page, variants, shipping and policies) fits well inside this. */
const MAX_BODY = 512_000;

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, MAX_BODY);
    const result = body.action === "create" ? await createStore(body, storeId)
      : body.action === "save" ? await saveStore(body, storeId)
      : body.action === "duplicate" ? await duplicateStore(body, storeId)
      : body.action === "preview" ? await saveStorePreview(body, storeId)
      : (() => { throw new HttpError(400, "Unknown action."); })();
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
