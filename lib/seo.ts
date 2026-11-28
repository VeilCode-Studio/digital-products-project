import "server-only";
import { deploymentLabel, getEnv } from "./env";
import type { CatalogProduct } from "./catalog.types";
import type { Storefront } from "./storefront";
import type { PublicReview } from "./reviews";

// What search engines and link previews read: absolute URLs, and schema.org Product data that makes
// products eligible for Google's free listings. Only production is ever indexed (app/robots.ts).
// Only verified buyer reviews (lib/reviews.ts) become ratings in the markup. Owner-written testimonials
// stay out on purpose: Google treats a store's own testimonials as self-serving and can penalise them.

export const BRAND = "PodStore";

export const indexable = () => deploymentLabel() === "production";

/** The site's public origin, e.g. https://pod.veilcode.studio. */
export function siteOrigin() { return new URL(getEnv().APP_URL).origin; }
export const absolute = (path: string) => new URL(path, siteOrigin()).toString();

const money = (minor: number) => (minor / 100).toFixed(2);

export type Ratings = { reviews: PublicReview[]; count: number; average: number };

/** aggregateRating plus a few reviews, from verified buyers only; nothing when there are none. */
function ratingLd(ratings?: Ratings | null) {
  if (!ratings?.count) return {};
  return {
    aggregateRating: { "@type": "AggregateRating", ratingValue: ratings.average.toFixed(1), reviewCount: ratings.count, bestRating: 5, worstRating: 1 },
    review: ratings.reviews.slice(0, 5).map((review) => ({
      "@type": "Review", reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5 },
      author: { "@type": "Person", name: review.display_name }, datePublished: review.created_at.slice(0, 10),
      ...(review.title ? { name: review.title } : {}), ...(review.body ? { reviewBody: review.body } : {}),
    })),
  };
}
const IN_STOCK = "https://schema.org/InStock";

export function digitalProductLd(product: CatalogProduct, ratings?: Ratings | null, canonical?: string, brand = BRAND) {
  if (product.price_amount === null) return null;
  const url = canonical ?? absolute(`/p/${product.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.tagline || product.description.slice(0, 500) || undefined,
    image: product.cover_path ? [absolute(`/api/products/${encodeURIComponent(product.id)}/cover/${product.revision}`)] : undefined,
    sku: product.id,
    brand: { "@type": "Brand", name: brand },
    url,
    offers: {
      "@type": "Offer", url, price: money(product.price_amount), priceCurrency: product.currency.toUpperCase(),
      availability: IN_STOCK, itemCondition: "https://schema.org/NewCondition",
    },
    ...ratingLd(ratings),
  };
}

export function physicalProductLd(store: Storefront, images: string[], ratings?: Ratings | null, canonical?: string) {
  if (!store.variants.length) return null;
  const url = canonical ?? absolute(`/s/${store.product.slug}`);
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
    ...ratingLd(ratings),
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
