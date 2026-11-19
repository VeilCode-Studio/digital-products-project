import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedProduct } from "./fakes";

// Which deployment this is; everything else about the environment stays the normal test setup.
const deployment = vi.hoisted(() => ({ label: "production" as string }));
vi.mock("../lib/env", async (original) => ({ ...(await original<typeof import("../lib/env")>()), deploymentLabel: () => deployment.label }));
import sitemap from "../app/sitemap";
import robots from "../app/robots";
import { digitalProductLd, physicalProductLd } from "../lib/seo";
import type { Storefront } from "../lib/storefront";

beforeEach(() => { resetFakes(); deployment.label = "production"; });
const SITE = "https://delivery.example.com";

describe("search engines", () => {
  it("lets crawlers into production only, with the sitemap and without the workspace", () => {
    const rules = robots();
    expect(rules.sitemap).toBe(`${SITE}/sitemap.xml`);
    expect(JSON.stringify(rules.rules)).toContain("/admin");
    deployment.label = "preview";
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });

  it("lists published, priced products and the help pages, and nothing on previews", async () => {
    seedProduct({ slug: "kit" });
    seedProduct({ slug: "draft-kit", status: "draft" });
    seedProduct({ slug: "unpriced", price_amount: null, stripe_price_id: null });
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain(`${SITE}/`);
    expect(urls).toContain(`${SITE}/p/kit`);
    expect(urls).toContain(`${SITE}/support`);
    expect(urls.some((url) => url.includes("draft-kit") || url.includes("unpriced"))).toBe(false);
    deployment.label = "preview";
    expect(await sitemap()).toEqual([]);
  });

  it("describes products the way Google's free listings read them", () => {
    const digital = digitalProductLd(seedProduct({ slug: "kit", price_amount: 2900, cover_path: "c.png" }))!;
    expect(digital).toMatchObject({ "@type": "Product", url: `${SITE}/p/kit`, offers: { price: "29.00", priceCurrency: "USD", availability: "https://schema.org/InStock" } });
    expect(digital.image?.[0]).toMatch(new RegExp(`^${SITE}/api/products/`));
    expect(digitalProductLd(seedProduct({ price_amount: null }))).toBeNull();

    const store = {
      product: { id: "p1", slug: "lamp", name: "Mira Lamp", tagline: "Soft light", description: "", currency: "usd", draft: false },
      brand: { name: "Mira" }, variants: [{ id: "v1", label: "White", price: 3900 }, { id: "v2", label: "Black", price: 4200 }],
    } as unknown as Storefront;
    const physical = physicalProductLd(store, ["https://cdn.example/a.jpg"])!;
    expect(physical.offers.map((offer) => offer.price)).toEqual(["39.00", "42.00"]);
    expect(physical).toMatchObject({ brand: { name: "Mira" }, image: ["https://cdn.example/a.jpg"] });
    expect(JSON.stringify(physical)).not.toContain("aggregateRating");
  });
});
