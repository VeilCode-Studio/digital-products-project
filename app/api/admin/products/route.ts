import { requireWorkspace } from "@/lib/workspace";
import { sameOrigin, apiError, HttpError } from "@/lib/http";
import { saveProduct } from "@/lib/manage-products";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    if (Number(req.headers.get("content-length")) > 4_000_000) throw new HttpError(413, "This save is too large. Reload the editor to use direct file uploads.");
    const product = await saveProduct(await req.formData(), storeId);
    return Response.json({ ok: true, id: product.id, revision: product.revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
