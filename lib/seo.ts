import "server-only";
import { deploymentLabel, getEnv } from "./env";
import type { CatalogProduct } from "./catalog.types";
import type { Storefront } from "./storefront";

// What search engines and link previews read: absolute URLs, and schema.org Product data that makes
// products eligible for Google's free listings. Only production is ever indexed (app/robots.ts).
// Owner-written reviews stay out of the markup on purpose: Google treats a store's own testimonials
// as self-serving and can penalise pages that mark them up as ratings.

export const BRAND = "PodStore";

export const indexable = () => deploymentLabel() === "production";

/** The site's public origin, e.g. https://pod.veilcode.studio. */
export function siteOrigin() { return new URL(getEnv().APP_URL).origin; }
export const absolute = (path: string) => new URL(path, siteOrigin()).toString();

const money = (minor: number) => (minor / 100).toFixed(2);
const IN_STOCK = "https://schema.org/InStock";

export function digitalProductLd(product: CatalogProduct) {
  if (product.price_amount === null) return null;
  const url = absolute(`/p/${product.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.tagline || product.description.slice(0, 500) || undefined,
    image: product.cover_path ? [absolute(`/api/products/${encodeURIComponent(product.id)}/cover/${product.revision}`)] : undefined,
    sku: product.id,
    brand: { "@type": "Brand", name: BRAND },
    url,
    offers: {
      "@type": "Offer", url, price: money(product.price_amount), priceCurrency: product.currency.toUpperCase(),
      availability: IN_STOCK, itemCondition: "https://schema.org/NewCondition",
    },
  };
}

export function physicalProductLd(store: Storefront, images: string[]) {
  if (!store.variants.length) return null;
  const url = absolute(`/s/${store.product.slug}`);
  const currency = store.product.currency.toUpperCase();
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: store.product.name,
    description: store.product.tagline || store.product.description.slice(0, 500) || undefined,
    image: images.length ? images : undefined,
    sku: store.product.id,
    brand: { "@type": "Brand", name: store.brand.name || BRAND },
    url,
    // One offer per variant, so Google can show the right price for each colour or size.
    offers: store.variants.map((variant) => ({
      "@type": "Offer", url, sku: variant.id,
      name: variant.label || undefined, price: money(variant.price), priceCurrency: currency,
      availability: IN_STOCK, itemCondition: "https://schema.org/NewCondition",
    })),
  };
}

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND,
    url: siteOrigin(),
    logo: absolute("/brand/podstore-mark.svg"),
  };
}
