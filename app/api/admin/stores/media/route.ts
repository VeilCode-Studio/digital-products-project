import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { confirmStoreMedia, deleteStoreMedia, prepareStoreMedia } from "@/lib/manage-stores";
import { importCjPhotos } from "@/lib/cj-media";

export const runtime = "nodejs";
export const maxDuration = 60;

// Files go straight from the browser to Storage with a one-file signed URL ("prepare"), are then
// checked here ("confirm"), and can be deleted while unused ("delete"). "import-cj" copies a CJ product's photos in.
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req);
    const result = body.action === "prepare" ? await prepareStoreMedia(body, storeId)
      : body.action === "confirm" ? await confirmStoreMedia(body, storeId)
      : body.action === "delete" ? await deleteStoreMedia(body, storeId)
      : body.action === "import-cj" ? await importCjPhotos(body, 10, 45_000, storeId)
      : (() => { throw new HttpError(400, "Unknown action."); })();
    return Response.json(result, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return apiError(error); }
}
