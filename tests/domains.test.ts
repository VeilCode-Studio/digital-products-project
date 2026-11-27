import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { resetFakes, seedProduct, state, sessionsCreate } from "./fakes";
import { stubDevelopment } from "./env";
import { normalizeDomain, domainPurchasePreview, domainPath } from "../lib/domain-rules";
import { domainProduct, shopperOrigin, publicProductUrl } from "../lib/domains";
import { connectDomain, checkDomain, removeDomain, searchDomain, rehearsePurchase, domainServiceState } from "../lib/domain-provider";
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

describe("domain validation and purchase preview controls", () => {
  it("normalizes hostnames and rejects URLs, IPs, local hosts and platform aliases", () => {
    expect(normalizeDomain(" Shop.MyBrand.com. ")).toBe("shop.mybrand.com");
    expect(normalizeDomain("bücher.de")).toBe("xn--bcher-kva.de");
    for (const value of ["https://mybrand.com", "mybrand.com/path", "a@mybrand.com", "127.0.0.1", "localhost", "x.local", "x.vercel.app", "a.com:443", "mybrand.com?x=1", "a..com", "-a.com"]) expect(normalizeDomain(value)).toBeNull();
  });
  it("keeps discovery disabled unless explicitly enabled", async () => {
    expect(domainPurchasePreview()).toBe(false);
    await expect(searchDomain("mybrand.com")).rejects.toMatchObject({ status: 404 });
    expect(fetch).not.toHaveBeenCalled();
    expect(domainPurchasePreview({ DOMAIN_PURCHASE_PREVIEW: "true", DEPLOYMENT_ENV: "unknown" })).toBe(false);
  });
  it("allows production discovery and simulation without payment or registration calls", async () => {
    vi.stubEnv("DOMAIN_PURCHASE_PREVIEW", "true");
    expect(domainPurchasePreview()).toBe(true);
    respond({ results: [{ domain: "mybrand.com", available: true, years: 1, price: 12, renewalPrice: 15, premium: false }] });
    expect(await rehearsePurchase("mybrand.com", 12)).toMatchObject({ simulated: true, charged: false, registered: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.vercel.com/v1/registrar/domains/search");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
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
  it("recovers a false negative from combined search using exact-domain availability and prices", async () => {
    stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
    respond({ results: [{ domain: "leadtokickoff.store", available: false }] });
    respond({ available: true });
    respond({ years: 1, purchasePrice: 1.49, renewalPrice: 44, transferPrice: 44 });
    expect(await searchDomain("leadtokickoff.store")).toEqual([{ domain: "leadtokickoff.store", available: true, years: 1, price: 1.49, renewalPrice: 44 }]);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      "https://api.vercel.com/v1/registrar/domains/search",
      "https://api.vercel.com/v1/registrar/domains/leadtokickoff.store/availability",
      "https://api.vercel.com/v1/registrar/domains/leadtokickoff.store/price",
    ]);
  });
  it("reports unavailable only after the explicit availability endpoint confirms it", async () => {
    stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
    respond({ results: [{ domain: "leadtokickoff.com", available: false }] });
    respond({ available: false });
    expect(await searchDomain("leadtokickoff.com")).toEqual([{ domain: "leadtokickoff.com", available: false }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([500, 429])("does not call an availability failure (%s) an unavailable domain", async (status) => {
    stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
    respond({ results: [{ domain: "leadtokickoff.com", available: false }] });
    respond({ error: "provider unavailable" }, status);
    expect(await searchDomain("leadtokickoff.com")).toEqual([{ domain: "leadtokickoff.com", available: null }]);
  });
  it("preserves confirmed availability when pricing fails or is nonnumeric", async () => {
    stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
    respond({ results: [{ domain: "leadtokickoff.com", available: false }] });
    respond({ available: true }); respond({ years: 1, purchasePrice: "Price unavailable", renewalPrice: 12.03 });
    expect(await searchDomain("leadtokickoff.com")).toEqual([{ domain: "leadtokickoff.com", available: true }]);
    respond({ results: [{ domain: "leadtokickoff.com", available: true, years: 1 }] });
    respond({}, 500);
    await expect(rehearsePurchase("leadtokickoff.com", 6.99)).rejects.toMatchObject({ status: 409 });
  });
  it("falls back after a search failure, missing result or malformed result", async () => {
    stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
    for (const result of [null, {}, { results: [] }, { results: [null, "unexpected"] }]) {
      respond(result ?? {}, result === null ? 503 : 200);
      respond({ available: true }); respond({ years: 1, purchasePrice: 6.99, renewalPrice: 12.03 });
      expect(await searchDomain("leadtokickoff.com")).toMatchObject([{ available: true, price: 6.99 }]);
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
  it.each([401, 403])("rejects an unusable credential (%s) before creating a pending record", async (status) => {
    const product = seedProduct();
    respond({ error: { message: "private-provider-detail" } }, status);
    await expect(connectDomain(product.id, "mybrand.com")).rejects.toMatchObject({ status: 503 });
    expect(state.store_domains).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("does not consider a configured token verified until the intended project is returned", async () => {
    respond({ id: "different-project" });
    expect(await domainServiceState()).toMatchObject({ ready: false });
    respond({ id: "project-test" });
    expect(await domainServiceState()).toMatchObject({ ready: true });
    expect(state.store_domains).toHaveLength(0);
  });
  it("does not expose provider errors or credentials through health results", async () => {
    respond({ error: { message: "private-provider-detail" } }, 403);
    const result = await domainServiceState();
    expect(result.ready).toBe(false);
    expect(result.message).toContain("permission");
    expect(JSON.stringify(result)).not.toMatch(/private-provider-detail|provider-test-token|team-test/);
  });
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
    respond({ id: "project-test" }); respond({ ...assigned, gitBranch: "staging" }); respond({ ...assigned, gitBranch: "staging" }); respond(configured); respond({ certs: [] });
    await connectDomain(product.id, "mybrand.com");
    const options = vi.mocked(fetch).mock.calls[2][1];
    expect(JSON.parse(options?.body as string)).toEqual({ name: "mybrand.com", gitBranch: "staging" });
  });
  it("never forcibly moves an existing domain and retains failed reservations for reconciliation", async () => {
    const product = seedProduct();
    respond({ id: "project-test" });
    respond({ error: {} }, 409);
    await expect(connectDomain(product.id, "mybrand.com")).rejects.toMatchObject({ status: 409 });
    expect(state.store_domains).toHaveLength(1);
    expect(state.store_domains[0].status).toBe("pending");
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]?.body as string)).not.toHaveProperty("force");
  });
  it("will not remove a domain belonging to another environment", async () => {
    const { domain } = seedDomain();
    respond({ ...assigned, gitBranch: "staging" });
    await expect(removeDomain(domain.id)).rejects.toMatchObject({ status: 409 });
    expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.method !== "DELETE")).toBe(true);
  });
});
