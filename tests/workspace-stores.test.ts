import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, seedPhysicalStore, state, rpc, signedUpload, storageCopy, storageInfo, storageList, storageRemove } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { createStore, duplicateStore, loadStoreEditor, saveStore, saveStorePreview, prepareStoreMedia, confirmStoreMedia, deleteStoreMedia } from "../lib/manage-stores";
import { importCjPhotos } from "../lib/cj-media";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined }) }));
import { POST as storesRoute } from "../app/api/admin/stores/route";
import { POST as mediaRoute } from "../app/api/admin/stores/media/route";
const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
beforeEach(() => {
  resetFakes(); jar.clear();
  state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: randomUUID(), name: "Other workspace" });
});
async function newStore() {
  const { id } = await createStore({ name: "A lamp", slug: "glow" }, otherStore);
  return state.products.find(p => p.id === id)!;
}
function draft(id: string, overrides: Record<string, unknown> = {}) {
  return { id, revision: 0, status: "draft", name: "A lamp", slug: "glow", tagline: "", theme: "clean-minimal", brand: { name: "My brand" }, page: { version: 1, sections: [] }, variants: [], profiles: [], shippingProfileId: null, policies: {}, ...overrides };
}
function post(handler: (req: Request) => Promise<Response>, path: string, body: Record<string, unknown>) {
  return handler(new Request(`https://delivery.example.com${path}`, { method: "POST", headers: { origin: "https://delivery.example.com", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}
it("creates, edits, and duplicates physical drafts inside their workspace", async () => {
  const original = seedPhysicalStore().product;
  const product = await newStore();
  await saveStore(draft(product.id), otherStore);
  expect(product).toMatchObject({ store_id: otherStore, revision: 1, status: "draft" });
  expect(rpc).toHaveBeenCalledWith("save_physical_store", expect.objectContaining({ p_store_id: otherStore, p_product_id: product.id }));
  const copy = await duplicateStore({ id: product.id }, otherStore);
  expect(state.products.find(p => p.id === copy.id)).toMatchObject({ store_id: otherStore, slug: "glow-copy", status: "draft" });
  expect(original.revision).toBe(1);
});
it("refuses foreign editor, save, preview, copy, and media operations before storage or writes", async () => {
  const product = seedPhysicalStore().product;
  const raw = { id: product.id, productId: product.id, path: `${STORE_ID}/${product.id}/media/a.webp` };
  for (const action of [() => loadStoreEditor(product.id, otherStore), () => saveStore(raw, otherStore), () => saveStorePreview(raw, otherStore), () => duplicateStore(raw, otherStore), () => prepareStoreMedia(raw, otherStore), () => confirmStoreMedia(raw, otherStore), () => deleteStoreMedia(raw, otherStore)]) {
    await expect(action()).rejects.toMatchObject({ status: 404 });
  }
  expect(rpc).not.toHaveBeenCalled(); expect(signedUpload).not.toHaveBeenCalled(); expect(storageCopy).not.toHaveBeenCalled(); expect(storageList).not.toHaveBeenCalled(); expect(storageInfo).not.toHaveBeenCalled(); expect(storageRemove).not.toHaveBeenCalled();
});
it("loads only the workspace's shipping profiles and excludes platform pixel configuration", async () => {
  seedPhysicalStore();
  state.shipping_profiles.push({ id: "legacy-profile", store_id: STORE_ID, name: "Legacy shipping", created_at: new Date().toISOString() });
  state.shipping_profiles.push({ id: "merchant-profile", store_id: otherStore, name: "My shipping", created_at: new Date().toISOString() });
  const product = await newStore();
  const data = await loadStoreEditor(product.id, otherStore);
  expect(data.profiles.map(p => p.id)).toEqual(["merchant-profile"]);
  expect(data.variants).toEqual([]); expect(data.tiktokServerPixels).toEqual([]); expect(data.metaServerPixels).toEqual([]);
  expect(storageList).toHaveBeenCalledWith(`${otherStore}/${product.id}/media`, expect.any(Object));
});
it("rejects another workspace's shipping profile before RPC mutation", async () => {
  const product = await newStore();
  const profileId = randomUUID();
  state.shipping_profiles.push({ id: profileId, store_id: STORE_ID, name: "Legacy shipping", created_at: new Date().toISOString() });
  await expect(saveStore(draft(product.id, { shippingProfileId: profileId }), otherStore)).rejects.toMatchObject({ status: 400 });
  expect(rpc).not.toHaveBeenCalled();
});
it("uses the merchant media folder and refuses foreign file paths before inspection or deletion", async () => {
  const product = await newStore();
  const prepared = await prepareStoreMedia({ productId: product.id, filename: "photo.png", size: 50 }, otherStore);
  expect(prepared.path).toContain(`${otherStore}/${product.id}/media/`);
  const raw = { productId: product.id, path: `${STORE_ID}/${product.id}/media/photo.png` };
  await expect(confirmStoreMedia(raw, otherStore)).rejects.toMatchObject({ status: 400 });
  await expect(deleteStoreMedia(raw, otherStore)).rejects.toMatchObject({ status: 400 });
  expect(storageInfo).not.toHaveBeenCalled(); expect(storageRemove).not.toHaveBeenCalled();
});
it("does not import through the platform's CJ credentials for an independent merchant", async () => {
  await expect(importCjPhotos({ productId: randomUUID() }, 10, 45_000, otherStore)).rejects.toMatchObject({ status: 503 });
  expect(signedUpload).not.toHaveBeenCalled();
});
it("uses database ownership for both physical-store and media endpoints", async () => {
  state.stores[0].owner_user_id = null; state.stores[1].owner_user_id = OWNER_ID; jar.set("veilcode_owner", "owner-token");
  const result = await post(storesRoute, "/api/admin/stores", { action: "create", storeId: STORE_ID, name: "My lamp", slug: "glow" });
  expect(result.status).toBe(200);
  const product = state.products[0]; expect(product.store_id).toBe(otherStore);
  const upload = await post(mediaRoute, "/api/admin/stores/media", { action: "prepare", storeId: STORE_ID, productId: product.id, filename: "photo.png", size: 50 });
  expect(upload.status).toBe(200); expect((await upload.json()).path).toContain(`${otherStore}/${product.id}/media/`);
});
