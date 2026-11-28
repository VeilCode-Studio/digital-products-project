import { requireWorkspace } from "@/lib/workspace";
import { apiError, jsonObject, sameOrigin } from "@/lib/http";
import { prepareProductUpload } from "@/lib/product-uploads";

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const upload = await prepareProductUpload(await jsonObject(req), storeId);
    return Response.json(upload, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
