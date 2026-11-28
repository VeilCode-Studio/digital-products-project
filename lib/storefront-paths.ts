import { STORE_ID } from "./store-config";

export const STORE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Existing URLs stay with the original store. Independent stores have an immutable namespace. */
export function storePath(storeId = STORE_ID) {
  if (!STORE_UUID.test(storeId)) throw new Error("Invalid storefront identifier");
  return storeId === STORE_ID ? "" : `/shops/${storeId}`;
}
export function productPath(product: { store_id?: string; kind?: string; slug: string }) {
  return `${storePath(product.store_id)}/${product.kind === "physical" ? "s" : "p"}/${encodeURIComponent(product.slug)}`;
}
