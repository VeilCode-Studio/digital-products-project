import type { CatalogProduct } from "./catalog.types";
import { productPath } from "./storefront-paths";

/**
 * Where a product's public page lives: /p/<slug> for a digital product, /s/<slug> for a store. A draft gets
 * the owner-only preview of the same page, which shows what's there instead of a not-found page.
 */
export function productPageHref(product: Pick<CatalogProduct, "kind" | "slug" | "status"> & { store_id?: string }) {
  const path = productPath(product);
  return product.status === "published" ? path : `${path}?preview=1`;
}
