import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, seedProduct, state, productsCreate, productsUpdate, pricesCreate, signedUpload, storageInfo, storageDownload } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { saveProduct } from "../lib/manage-products";
import { getCatalogProduct } from "../lib/catalog";
import { relatedChoices } from "../lib/related-products";
import { prepareProductUpload, resolveProductUpload } from "../lib/product-uploads";
import { domainPath } from "../lib/domain-rules";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined }) }));
import { POST as saveRoute } from "../app/api/admin/products/route";
import { POST as uploadRoute } from "../app/api/admin/products/upload/route";
import { GET as coverRoute } from "../app/api/products/[id]/cover/route";

const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
beforeEach(() => {
  resetFakes(); jar.clear();
  state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: randomUUID(), name: "Other workspace" });
});
function form(overrides: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({ id: randomUUID(), revision: "0", name: "My guide", slug: "my-guide", tagline: "A useful guide", description: "Practical resources", includes: "Guide", price: "19.00", currency: "usd", status: "draft", sort_order: "0", templates_url: "", ...overrides })) result.set(key, value);
  return result;
}
const cover = (id: string, preview = false) => coverRoute(new Request(`https://delivery.example.com/api/products/${id}/cover${preview ? "?preview=1" : ""}`), { params: Promise.resolve({ id }) });
function moveOwner() {
  state.stores[0].owner_user_id = null;
  state.stores[1].owner_user_id = OWNER_ID;
  jar.set("veilcode_owner", "owner-token");
}

it("creates and edits independent drafts without touching the platform's Stripe products", async () => {
  const original = seedProduct();
  const created = await saveProduct(form({ slug: original.slug }), otherStore);
  const saved = await saveProduct(form({ id: created.id, revision: "1", slug: original.slug, name: "Updated guide" }), otherStore);
  expect(saved).toMatchObject({ store_id: otherStore, name: "Updated guide", revision: 2, stripe_product_id: null });
  expect(await getCatalogProduct(created.id)).toBeNull();
  expect((await getCatalogProduct(original.id))?.name).toBe(original.name);
  expect(productsCreate).not.toHaveBeenCalled(); expect(productsUpdate).not.toHaveBeenCalled(); expect(pricesCreate).not.toHaveBeenCalled();
});
it("refuses foreign product saves at both an existing revision and revision zero", async () => {
  const original = seedProduct();
  const snapshot = structuredClone(original);
  for (const revision of ["1", "0"]) await expect(saveProduct(form({ id: original.id, revision }), otherStore)).rejects.toMatchObject({ status: 409 });
  expect(state.products).toEqual([snapshot]);
  expect(productsCreate).not.toHaveBeenCalled(); expect(productsUpdate).not.toHaveBeenCalled();
});
it("cannot publish an unconnected merchant through the platform Stripe account", async () => {
  const id = randomUUID();
  const product = seedProduct({ id, store_id: otherStore, status: "draft", storage_path: `${otherStore}/${id}/downloads/guide.pdf`, stripe_product_id: null, stripe_price_id: null });
  await expect(saveProduct(form({ id, revision: "1", status: "published" }), otherStore)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("Connect Stripe") });
  expect(product.status).toBe("draft"); expect(product.revision).toBe(1);
  expect(productsCreate).not.toHaveBeenCalled(); expect(pricesCreate).not.toHaveBeenCalled();
});
it("limits related selections to the selected workspace", async () => {
  const foreign = seedProduct();
  const own = seedProduct({ store_id: otherStore, slug: "own", status: "draft", storage_path: null });
  expect((await relatedChoices(null, otherStore)).map(p => p.id)).toEqual([own.id]);
  const saved = await saveProduct(form({ related: `${foreign.id},${own.id}` }), otherStore);
  expect(saved.related_ids).toEqual([own.id]);
});
it("binds signed uploads to the workspace and rejects cross-store replay before accessing storage", async () => {
  const id = randomUUID();
  const prepared = await prepareProductUpload({ productId: id, revision: 0, kind: "download", filename: "guide.pdf", size: 5 }, otherStore);
  expect(signedUpload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${otherStore}/${id}/downloads/`)), { upsert: false });
  await expect(resolveProductUpload(prepared.receipt, id, 0, "download", STORE_ID)).rejects.toMatchObject({ status: 400 });
  expect(storageInfo).not.toHaveBeenCalled(); expect(storageDownload).not.toHaveBeenCalled();
  storageDownload.mockResolvedValueOnce({ data: new Blob(["%PDF-"], { type: "application/pdf" }), error: null });
  const saved = await saveProduct(form({ id, download_upload: prepared.receipt }), otherStore);
  expect(saved.storage_path).toMatch(new RegExp(`^${otherStore}/${id}/downloads/`));
});
it("derives save and upload workspaces from ownership even when the browser sends another store ID", async () => {
  moveOwner();
  const body = form({ store_id: STORE_ID });
  const response = await saveRoute(new Request("https://delivery.example.com/api/admin/products", { method: "POST", headers: { origin: "https://delivery.example.com" }, body }));
  expect(response.status).toBe(200);
  expect(state.products[0].store_id).toBe(otherStore);
  const upload = await uploadRoute(new Request("https://delivery.example.com/api/admin/products/upload", { method: "POST", headers: { origin: "https://delivery.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ storeId: STORE_ID, productId: body.get("id"), revision: 1, kind: "cover", filename: "cover.png", size: 12 }) }));
  expect(upload.status).toBe(200);
  expect(signedUpload).toHaveBeenCalledWith(expect.stringContaining(`${otherStore}/${body.get("id")}/covers/`), { upsert: false });
});
it("keeps draft covers private to the database owner while serving published covers", async () => {
  const id = randomUUID();
  const product = seedProduct({ id, store_id: otherStore, status: "draft", cover_path: `${otherStore}/${id}/covers/cover.png`, cover_type: "image/png" });
  expect((await cover(id)).status).toBe(404);
  jar.set("veilcode_owner", "owner-token");
  expect((await cover(id, true)).status).toBe(404);
  expect(storageDownload).not.toHaveBeenCalled();
  moveOwner();
  const preview = await cover(id, true);
  expect(preview.status).toBe(200); expect(preview.headers.get("Cache-Control")).toBe("private, no-store");
  jar.clear(); product.status = "published";
  expect((await cover(id)).status).toBe(200);
});
it("rejects foreign storage paths and unrelated product assets on custom domains", async () => {
  const product = seedProduct({ store_id: otherStore, cover_path: `${STORE_ID}/private-cover.png`, cover_type: "image/png" });
  expect((await cover(product.id)).status).toBe(404); expect(storageDownload).not.toHaveBeenCalled();
  await expect(saveProduct(form({ id: product.id, revision: "1" }), otherStore)).rejects.toMatchObject({ status: 409 });
  expect(domainPath(`/api/products/${randomUUID()}/cover`, product)).toBeNull();
  expect(domainPath(`/api/products/${product.id}/cover`, product)).toBe(`/api/products/${product.id}/cover`);
});
