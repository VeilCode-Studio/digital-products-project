import Link from "next/link";
import { ArrowUpRight, Eye, Package, PencilLine, Store } from "lucide-react";
import type { CatalogProduct } from "@/lib/catalog.types";
import { formatMoney } from "@/lib/store-config";
import { THEME_TOKENS, type ThemeId } from "@/lib/store-themes";
import { productPageHref } from "@/lib/product-links";
import { DuplicateStoreButton } from "@/components/duplicate-store-button";

/**
 * The rows of /admin/products (digital) and /admin/stores (physical). `prices` holds each physical
 * store's lowest active variant price; digital products carry their own.
 */
export function CatalogList({ products, prices }: { products: CatalogProduct[]; prices?: Map<string, number> }) {
  return <div className="catalog-list">{products.map((product) => {
    const physical = product.kind === "physical";
    const lowest = prices?.get(product.id);
    const price = physical ? (lowest === undefined ? "No price yet" : `from ${formatMoney(lowest, product.currency)}`)
      : product.price_amount === null ? "Price not set" : formatMoney(product.price_amount, product.currency);
    const theme = product.theme && product.theme in THEME_TOKENS ? ` · ${THEME_TOKENS[product.theme as ThemeId].label}` : "";
    return <div className="catalog-row" key={product.id}>
      <div className="catalog-icon">{physical ? <Store size={24} /> : <Package size={24} />}</div>
      <div className="catalog-name">
        <Link href={`/admin/products/${product.id}`}>{product.name}</Link>
        <span>{physical ? `/s/${product.slug}${theme}` : `/p/${product.slug}`}</span>
      </div>
      <span className={`badge ${product.status}`}>{product.status === "published" ? (physical ? "Live" : "Published") : "Draft"}</span>
      <strong className="catalog-price">{price}</strong>
      <div className="catalog-actions">
        <a className="button secondary small" href={productPageHref(product)} target="_blank" rel="noopener noreferrer"
          aria-label={`${product.status === "published" ? "View" : "Preview"} the page for ${product.name} in a new tab`}>
          {product.status === "published" ? <>View <ArrowUpRight size={14} aria-hidden="true" /></> : <>Preview <Eye size={14} aria-hidden="true" /></>}
        </a>
        {physical && <DuplicateStoreButton id={product.id} name={product.name} />}
        <Link className="button secondary small" href={`/admin/products/${product.id}`}><PencilLine size={14} aria-hidden="true" /> Edit</Link>
      </div>
    </div>;
  })}</div>;
}
