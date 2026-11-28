import { STORE_ID } from "@/lib/store-config";
import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { createResearch, createStoreFromResearch, deleteResearch, updateResearch } from "@/lib/research";
import { searchMetaAds } from "@/lib/meta-ads";
import { metaFilters } from "@/lib/research.types";
import { cjDetail, searchCj } from "@/lib/cj";
import { createDigitalFromResearch } from "@/lib/research-digital";

export const runtime = "nodejs";
export const maxDuration = 30;

/** The research board's one endpoint (/admin/research). Every action needs the owner. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 64_000);
    const query = () => {
      const value = typeof body.query === "string" ? body.query.replace(/\s+/g, " ").trim() : "";
      if (value.length < 2 || value.length > 100) throw new HttpError(400, "Search for 2 to 100 characters.");
      return value;
    };
    if (storeId !== STORE_ID && ["meta-search", "cj-search", "cj-detail"].includes(String(body.action))) throw new HttpError(503, "Supplier search is not configured for this workspace. Add research manually.");
    let result: unknown;
    switch (body.action) {
      case "create": result = { item: await createResearch(body, storeId) }; break;
      case "update": result = { item: await updateResearch(body, storeId) }; break;
      case "delete": result = await deleteResearch(body, storeId); break;
      case "create-store": result = await createStoreFromResearch(body, storeId); break;
      case "create-digital": result = await createDigitalFromResearch(body, storeId); break;
      case "meta-search": result = await searchMetaAds(query(), metaFilters(body.filters)); break;
      case "cj-search": result = { products: await searchCj(query(), body.usStock === true) }; break;
      case "cj-detail": result = { supplier: await cjDetail(typeof body.pid === "string" ? body.pid : "") }; break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ ok: true, ...(result as object) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
