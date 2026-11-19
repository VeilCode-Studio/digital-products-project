import type { MetadataRoute } from "next";
import { listProducts } from "@/lib/catalog";
import { listStoreCards } from "@/lib/storefront";
import { LEGAL_KINDS } from "@/lib/site-legal";
import { absolute, indexable } from "@/lib/seo";

// Every public page Google should know about: the homepage, each published digital product and
// physical store, and the help and policy pages. Previews publish an empty sitemap (they're never indexed).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexable()) return [];
  const [digital, stores] = await Promise.all([
    listProducts(true, "digital").catch(() => []),
    listStoreCards().catch(() => []),
  ]);
  return [
    { url: absolute("/"), changeFrequency: "weekly", priority: 1 },
    ...digital.filter((product) => product.price_amount !== null).map((product) => ({
      url: absolute(`/p/${product.slug}`), lastModified: new Date(product.updated_at), changeFrequency: "weekly" as const, priority: 0.9,
    })),
    ...stores.map((store) => ({ url: absolute(`/s/${store.slug}`), changeFrequency: "weekly" as const, priority: 0.9 })),
    ...LEGAL_KINDS.map((kind) => ({ url: absolute(`/${kind}`), changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
