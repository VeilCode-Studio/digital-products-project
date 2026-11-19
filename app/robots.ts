import type { MetadataRoute } from "next";
import { absolute, indexable } from "@/lib/seo";

// Production lists its sitemap and keeps crawlers out of the workspace, APIs and order pages.
// Every other deployment asks not to be crawled at all.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/oauth", "/thank-you", "/download-error", "/s/*/thank-you", "/s/*/cancel"] },
    sitemap: absolute("/sitemap.xml"),
  };
}
