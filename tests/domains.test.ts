import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { resetFakes, seedProduct, state, sessionsCreate } from "./fakes";
import { stubDevelopment } from "./env";
import { normalizeDomain, domainPurchasePreview, domainPath } from "../lib/domain-rules";
import { domainProduct, shopperOrigin, publicProductUrl } from "../lib/domains";
import { connectDomain, checkDomain, removeDomain, searchDomain, rehearsePurchase } from "../lib/domain-provider";
import { startCheckout } from "../lib/checkout";
import { proxy } from "../proxy";

beforeEach(() => {
  resetFakes();
  vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "true");
  vi.stubEnv("DOMAIN_PURCHASE_PREVIEW", "false");
  vi.stubEnv("DOMAIN_VERCEL_TOKEN", "provider-test-token");
  vi.stubEnv("DOMAIN_VERCEL_PROJECT_ID", "project-test");
  vi.stubEnv("DOMAIN_VERCEL_TEAM_ID", "team-test");
  vi.stubGlobal("fetch", vi.fn());
});
const respond = (value: object, status = 200) => vi.mocked(fetch).mockResolvedValueOnce(Response.json(value, { status }));
function seedDomain(status: "active" | "pending" = "active") {
  const product = seedProduct();
  const domain = { id: randomUUID(), store_id: product.store_id, product_id: product.id, hostname: "mybrand.com", status, verification: [], checked_at: null, created_at: new Date().toISOString() };
  state.store_domains.push(domain);
  return { product, domain };
}

describe("domain validation and staging gate", () => {
  it("normalizes hostnames and rejects URLs, IPs, local hosts and platform aliases", () => {
    expect(normalizeDomain(" Shop.MyBrand.com. ")).toBe("shop.mybrand.com");
    expect(normalizeDomain("bücher.de")).toBe("xn--bcher-kva.de");
    for (const value of ["https://mybrand.com", "mybrand.com/path", "a@mybrand.com", "127.0.0.1", "localhost", "x.local", "x.vercel.app", "a.com:443", "mybrand.com?x=1", "a..com", "-a.com"]) expect(normalizeDomain(value)).toBeNull();
  });
  it("cannot enable purchasing in production, even with conflicting flags", async () => {
    vi.stubEnv("DOMAIN_PURCHASE_PREVIEW", "true");
    expect(domainPurchasePreview()).toBe(false);
    await expect(searchDomain("mybrand.com")).rejects.toMatchObject({ status: 404 });
    expect(fetch).not.toHaveBeenCalled();
    expect(domainPurchasePreview({ DOMAIN_PURCHASE_PREVIEW: "true", DEPLOYMENT_ENV: "preview", VERCEL_ENV: "production" })).toBe(false);
    expect(domainPurchasePreview({ DOMAIN_PURCHASE_PREVIEW: "true", DEPLOYMENT_ENV: "preview", VERCEL_TARGET_ENV: "production" })).toBe(false);
  });
  it("reads fresh availability and refuses a changed price without buying anything", async () => {
    stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
    respond({ results: [{ domain: "mybrand.com", available: true, price: 15, renewalPrice: 20, years: 1, premium: false }] });
    await expect(rehearsePurchase("mybrand.com", 10)).rejects.toMatchObject({ status: 409 });
    respond({ results: [{ domain: "mybrand.com", available: true, price: 15, renewalPrice: 20, years: 1, premium: false }] });
    expect(await rehearsePurchase("mybrand.com", 15)).toMatchObject({ simulated: true, charged: false, registered: false });
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(url).toBe("https://api.vercel.com/v1/registrar/domains/search");
      expect(options?.headers).not.toHaveProperty("Authorization");
    }
  });
});

describe("store domain resolution and checkout", () => {
  it("only resolves active, published products belonging to this store", async () => {
    const { product, domain } = seedDomain("pending");
    expect(await domainProduct(domain.hostname)).toBeNull();
    domain.status = "active"; product.status = "draft";
    expect(await domainProduct(domain.hostname)).toBeNull();
    product.status = "published";
    expect((await domainProduct(domain.hostname))?.id).toBe(product.id);
    expect(await publicProductUrl(product)).toBe("https://mybrand.com/");
    domain.store_id = randomUUID();
    expect(await domainProduct(domain.hostname)).toBeNull();
  });
  it("requires same-origin and the correct product on a verified custom host", async () => {
    const { product } = seedDomain();
    const req = new Request("https://mybrand.com/api/checkout", { headers: { origin: "https://mybrand.com" } });
    await expect(shopperOrigin(req, product.id)).resolves.toBeUndefined();
    await expect(shopperOrigin(req, "another-product")).rejects.toMatchObject({ status: 403 });
    await expect(shopperOrigin(new Request(req.url, { headers: { origin: "https://evil.com" } }), product.id)).rejects.toMatchObject({ status: 403 });
    await expect(shopperOrigin(new Request("https://evil.com/api/checkout", { headers: { origin: "https://mybrand.com" } }), product.id)).rejects.toMatchObject({ status: 403 });
  });
  it("returns buyers to the domain while keeping webhook deployment isolation", async () => {
    const { product } = seedDomain();
    await startCheckout(product.id, randomUUID());
    expect(sessionsCreate.mock.calls[0][0]).toMatchObject({ success_url: expect.stringContaining("https://mybrand.com/thank-you"), cancel_url: "https://mybrand.com/?checkout=cancelled" });
    expect(state.checkouts[0].checkout_origin).toBe("https://delivery.example.com");
  });
  it("rewrites only the assigned storefront and keeps admin APIs off custom domains", async () => {
    const { product } = seedDomain();
    const response = await proxy(new NextRequest("https://mybrand.com/?utm_source=test"));
    expect(response.headers.get("x-middleware-rewrite")).toBe(`https://mybrand.com/p/${product.slug}?utm_source=test`);
    expect((await proxy(new NextRequest("https://mybrand.com/api/admin/stores"))).status).toBe(404);
    expect((await proxy(new NextRequest("https://unknownbrand.com/"))).status).toBe(404);
    expect((await proxy(new NextRequest("https://mybrand.com/p/other-product"))).headers.get("location")).toBe("https://delivery.example.com/p/other-product");
    const redirected = await proxy(new NextRequest(`https://mybrand.com/p/${product.slug}?checkout=cancelled`));
    expect(redirected.headers.get("location")).toBe("https://mybrand.com/?checkout=cancelled");
    expect(domainPath("/policies/shipping", { kind: "physical", slug: "kit" })).toBe("/s/kit/policies/shipping");
    expect(domainPath("/policies/returns", { kind: "physical", slug: "kit" })).toBe("/s/kit/policies/returns");
    expect(domainPath("/policies/contact", { kind: "physical", slug: "kit" })).toBe("/s/kit/policies/contact");
  });
  it("does not query the new table when domain support is disabled", async () => {
    vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "false");
    state.dbError = true;
    expect(await domainProduct("mybrand.com")).toBeNull();
    expect(await publicProductUrl({ id: "a", slug: "kit", kind: "digital" })).toBe("https://delivery.example.com/p/kit");
  });
});

describe("domain provider verification", () => {
  const assigned = { name: "mybrand.com", apexName: "mybrand.com", verified: true, gitBranch: null };
  const configured = { misconfigured: false, recommendedIPv4: [{ rank: 1, value: ["192.0.2.20"] }], recommendedCNAME: [] };
  it("does not activate until a valid certificate exists and shows provider DNS values", async () => {
    const { domain } = seedDomain("pending");
    respond(assigned); respond(configured); respond({ certs: [] });
    const pending = await checkDomain(domain.id);
    expect(pending.status).toBe("pending");
    expect(pending.verification).toContainEqual({ type: "A", name: "mybrand.com", value: "192.0.2.20" });
    respond(assigned); respond(configured); respond({ certs: [{ cns: ["mybrand.com"], expiresAt: Date.now() + 86400_000 }] });
    expect((await checkDomain(domain.id)).status).toBe("active");
  });
  it("deactivates when DNS is no longer configured", async () => {
    const { domain } = seedDomain();
    respond(assigned); respond({ ...configured, misconfigured: true });
    expect((await checkDomain(domain.id)).status).toBe("pending");
  });
  it("refuses cross-environment verification and assigns staging domains to the staging branch", async () => {
    stubDevelopment({ DOMAIN_PREVIEW_BRANCH: "staging" });
    const { product, domain } = seedDomain("pending");
    respond(assigned);
    await expect(checkDomain(domain.id)).rejects.toMatchObject({ status: 409 });
    state.store_domains = [];
    respond({ ...assigned, gitBranch: "staging" }); respond({ ...assigned, gitBranch: "staging" }); respond(configured); respond({ certs: [] });
    await connectDomain(product.id, "mybrand.com");
    const options = vi.mocked(fetch).mock.calls[1][1];
    expect(JSON.parse(options?.body as string)).toEqual({ name: "mybrand.com", gitBranch: "staging" });
  });
  it("never forcibly moves an existing domain and retains failed reservations for reconciliation", async () => {
    const product = seedProduct();
    respond({ error: {} }, 409);
    await expect(connectDomain(product.id, "mybrand.com")).rejects.toMatchObject({ status: 409 });
    expect(state.store_domains).toHaveLength(1);
    expect(state.store_domains[0].status).toBe("pending");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).not.toHaveProperty("force");
  });
  it("will not remove a domain belonging to another environment", async () => {
    const { domain } = seedDomain();
    respond({ ...assigned, gitBranch: "staging" });
    await expect(removeDomain(domain.id)).rejects.toMatchObject({ status: 409 });
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "DELETE")).toBe(true);
  });
});
