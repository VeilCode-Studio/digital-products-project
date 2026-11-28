import "server-only";
import { HttpError } from "./http";
import { importStoreMediaBytes } from "./manage-stores";
import { cjConfigured, cjPidFromUrl, cjProductImages } from "./cj";
import type { StoreMediaFile } from "./store-media";
import { STORE_ID } from "./store-config";
import { getCatalogProduct } from "./catalog";

// Copies a CJ product's photos into a store's media library, so a new store starts with real product
// images. Only CJ's own CDN is fetched, and every file gets the same type and size checks as uploads.

const MAX_BYTES = 10 * 1024 * 1024;
const CJ_HOST = /(^|\.)cjdropshipping\.com$/;

async function download(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !CJ_HOST.test(new URL(response.url || url).hostname)) return null;
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length && bytes.length <= MAX_BYTES ? bytes : null;
  } catch { return null; }
}

/** Imports up to `max` photos of the CJ product a variant links to. Returns the files that were saved. */
export async function importCjPhotos(raw: Record<string, unknown>, max = 10, budgetMs = 45_000, storeId = STORE_ID) {
  // CJ credentials are currently platform-wide; independent merchants cannot use that account.
  if (storeId !== STORE_ID) throw new HttpError(503, "CJ photo imports are not configured for this workspace. Upload product photos instead.");
  if (!cjConfigured()) throw new HttpError(503, "Add CJ_API_KEY to this environment to import from CJ.");
  const productId = typeof raw.productId === "string" ? raw.productId : "";
  const product = await getCatalogProduct(productId, storeId);
  if (!product || product.kind !== "physical") throw new HttpError(404, "This store doesn't exist.");
  const pid = cjPidFromUrl(typeof raw.supplierUrl === "string" ? raw.supplierUrl : null);
  if (!pid) throw new HttpError(400, "Link a variant to a CJ product page first (its supplier link).");
  const started = Date.now();
  const images = await cjProductImages(pid, max);
  if (!images.length) throw new HttpError(404, "CJ has no photos for that product.");
  const saved: StoreMediaFile[] = [];
  let skipped = 0;
  for (const image of images) {
    if (Date.now() - started > budgetMs) { skipped += 1; continue; }
    const bytes = await download(image);
    if (!bytes) { skipped += 1; continue; }
    try {
      const file = await importStoreMediaBytes(productId, bytes, storeId);
      saved.push({ path: file.path, kind: file.kind, size: file.size, createdAt: file.createdAt, poster: null });
    } catch (error) {
      // The product itself is wrong (or gone): stop. A single odd file is just skipped.
      if (error instanceof HttpError && error.status === 404) throw error;
      skipped += 1;
    }
  }
  if (!saved.length) throw new HttpError(502, "None of CJ's photos for that product could be imported. Try again, or upload them yourself.");
  return { files: saved, skipped };
}
