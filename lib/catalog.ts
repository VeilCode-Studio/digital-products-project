import "server-only";
import { cache } from "react";
import { getSupabase } from "./supabase";
import { STORE_ID } from "./store-config";
import type { CatalogProduct, DeliveryProduct, ProductKind } from "./catalog.types";
import { getProduct } from "./products";
import { ownerUser } from "./auth";
import { workspaceForUser } from "./workspace";
import { STORE_UUID } from "./storefront-paths";

/** Cached per request, since the workspace layout and its page can both need it. */
export const getStore = cache(async function getStore(storeId = STORE_ID) {
  const { data, error } = await getSupabase().from("stores").select("*").eq("id", storeId).single();
  if (error || !data) throw new Error("Store unavailable. Apply the storefront migration.");
  return data;
});
export async function listProducts(published = false, kind?: ProductKind, storeId = STORE_ID) {
  let query = getSupabase().from("products").select("*").eq("store_id", storeId);
  if (published) query = query.eq("status", "published");
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.order("sort_order").order("created_at", { ascending: false });
  if (error) throw new Error("Could not load products");
  return data ?? [];
}
export async function getCatalogProduct(id: string, storeId = STORE_ID) {
  const { data, error } = await getSupabase().from("products").select("*").eq("store_id", storeId).eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load product");
  return data;
}
/** Product IDs are globally unique; only published rows are eligible for public assets. */
export async function getPublishedProductById(id: string) {
  const { data, error } = await getSupabase().from("products").select("*").eq("id", id).eq("status", "published").maybeSingle();
  if (error) throw new Error("Could not load product");
  return data;
}
/** Published product of one kind: /p/<slug> serves digital, /s/<slug> serves physical stores. */
export async function getPublicProduct(slug: string, kind: ProductKind = "digital", storeId = STORE_ID) {
  const { data, error } = await getSupabase().from("products").select("*")
    .eq("store_id", storeId).eq("slug", slug).eq("status", "published").eq("kind", kind).maybeSingle();
  if (error) throw new Error("Could not load product");
  return data;
}
/**
 * The digital product /p/<slug> shows: the published one, or with `preview` and the owner signed in, a draft
 * too, so the admin's "Preview page" works before launch. Everyone else gets null for a draft.
 */
export async function getDigitalPage(slug: string, preview: boolean, storeId = STORE_ID) {
  if (!STORE_UUID.test(storeId)) return null;
  const published = await getPublicProduct(slug, "digital", storeId);
  if (published || !preview) return published;
  const owner = await ownerUser();
  if (!owner || (await workspaceForUser(owner.id)).storeId !== storeId) return null;
  const { data, error } = await getSupabase().from("products").select("*")
    .eq("store_id", storeId).eq("slug", slug).eq("kind", "digital").maybeSingle();
  if (error) throw new Error("Could not load product");
  return data;
}
export function snapshotProduct(product: CatalogProduct): DeliveryProduct {
  if (!product.storage_path || !product.download_filename) throw new Error("Upload a download before publishing");
  return {
    name: product.name, shortName: product.name, emailSubject: `Your ${product.name} is ready`,
    storagePath: product.storage_path, downloadFilename: product.download_filename,
    templatesUrl: product.templates_url,
  };
}
export async function resolveDeliveryProduct(id: string, snapshot: DeliveryProduct | null, storeId = STORE_ID) {
  if (snapshot) return storeId === STORE_ID || snapshot.storagePath.startsWith(`${storeId}/${id}/downloads/`) ? snapshot : undefined;
  // Preserve pre-store purchases, including their original file location.
  const legacy = storeId === STORE_ID ? getProduct(id) : null;
  if (legacy) return legacy;
  const product = await getCatalogProduct(id, storeId);
  return product ? snapshotProduct(product) : undefined;
}
