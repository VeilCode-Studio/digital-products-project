import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, state } from "./fakes";
import { parseResearchFields } from "../lib/research";
import { cardFee, cjNotes, longestRunning, unitEconomics } from "../lib/research.types";
import { searchMetaAds, summariseAds } from "../lib/meta-ads";
import { cjDetail, cjProductUrl, searchCj, toCents } from "../lib/cj";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST } from "../app/api/admin/research/route";

const ORIGIN = "https://delivery.example.com";
const research = (body: Record<string, unknown>) => POST(new Request(`${ORIGIN}/api/admin/research`, {
  method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body),
}));
const json = async (response: Response) => ({ status: response.status, body: await response.json() as Record<string, unknown> & { item: Record<string, unknown> } });
const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

beforeEach(() => {
  resetFakes(); jar.clear(); jar.set("veilcode_owner", "owner-token");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("research board", () => {
  it("saves an idea, updates it, links a draft store made from it, and deletes it", async () => {
    const created = await json(await research({ action: "create", title: "  Posture corrector ", ads: [{ url: "https://www.facebook.com/ads/library/?id=1", page: "Selure", startedAt: daysAgo(45), source: "meta" }] }));
    expect(created.status).toBe(200);
    expect(created.body.item).toMatchObject({ title: "Posture corrector", stage: "saved", supplier: null });
    const id = created.body.item.id as string;

    const updated = await json(await research({
      action: "update", id, stage: "sourcing", target_price: 2999,
      supplier: { source: "cj", id: "ABC-1", name: "Magnetic posture belt", url: "https://cjdropshipping.com/product/belt-p-ABC-1.html", cost: 119, shipping: 649, shippingName: "CJPacket", days: "5-11 days" },
    }));
    expect(updated.body.item).toMatchObject({ stage: "sourcing", target_price: 2999, ads: [expect.objectContaining({ page: "Selure" })] });

    const made = await json(await research({ action: "create-store", id, slug: "upright" }));
    expect(made.status).toBe(200);
    const store = state.products.find((product) => product.id === made.body.productId);
    expect(store).toMatchObject({ name: "Posture corrector", slug: "upright", kind: "physical", status: "draft" });
    expect(state.research_products[0]).toMatchObject({ store_product_id: store!.id, stage: "testing" });

    const { listResearch } = await import("../lib/research");
    expect((await listResearch())[0].store).toEqual({ store_id: state.stores[0].id, slug: "upright", status: "draft", kind: "physical" });
    expect((await research({ action: "create-store", id, slug: "upright-2" })).status).toBe(409);

    expect((await research({ action: "delete", id })).status).toBe(200);
    expect(state.research_products).toEqual([]);
    expect(state.products.some((product) => product.id === store!.id)).toBe(true);
  });

  it("checks what it saves", () => {
    expect(() => parseResearchFields({ title: "" }, true)).toThrow("Product name is required");
    expect(() => parseResearchFields({ stage: "winning" })).toThrow("Choose a stage");
    expect(() => parseResearchFields({ image_url: "http://example.com/a.jpg" })).toThrow("https://");
    expect(() => parseResearchFields({ target_price: -1 })).toThrow("amount");
    expect(() => parseResearchFields({ target_price: 12.5 })).toThrow("amount");
    expect(() => parseResearchFields({ ads: Array.from({ length: 21 }, () => ({ url: "https://example.com" })) })).toThrow("20 ads");
    expect(() => parseResearchFields({ ads: [{ url: "https://example.com", startedAt: "last week" }] })).toThrow("start date");
    expect(() => parseResearchFields({ supplier: { name: "", cost: 100 } })).toThrow("Supplier product name");
    expect(parseResearchFields({ notes: "a\u0000b", supplier: null, target_price: "" })).toEqual({ notes: "ab", supplier: null, target_price: null });
  });

  it("needs the owner and the store's own origin", async () => {
    jar.clear();
    expect((await research({ action: "create", title: "Lamp" })).status).toBe(401);
    jar.set("veilcode_owner", "owner-token");
    const foreign = await POST(new Request(`${ORIGIN}/api/admin/research`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" }));
    expect(foreign.status).toBe(403);
    expect((await research({ action: "drop-tables" })).status).toBe(400);
    expect((await research({ action: "meta-search", query: "a" })).status).toBe(400);
  });
});

describe("profit per sale", () => {
  it("takes off the product, shipping and card fees", () => {
    expect(cardFee(2999)).toBe(117);
    const economics = unitEconomics({ target_price: 2999, supplier: { source: "cj", id: null, name: "Belt", url: null, cost: 119, shipping: 649, shippingName: null, days: null } });
    expect(economics).toMatchObject({ landed: 768, fees: 117, profit: 2114, shippingKnown: true });
    expect(economics!.margin).toBeCloseTo(0.705, 3);
    expect(unitEconomics({ target_price: null, supplier: null })).toBeNull();
  });

  it("reads how long the longest ad has run", () => {
    expect(longestRunning([
      { id: "1", url: "https://a.example", page: "", startedAt: daysAgo(12), source: "manual", note: "" },
      { id: "2", url: "https://b.example", page: "", startedAt: daysAgo(64), source: "meta", note: "" },
      { id: "3", url: "https://c.example", page: "", startedAt: null, source: "manual", note: "" },
    ])).toBe(64);
    expect(longestRunning([])).toBeNull();
  });
});

describe("Meta Ad Library", () => {
  it("groups an advertiser's versions of one ad and ranks long-running ones first", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    const ads = summariseAds([
      { id: "new", page_id: "1", page_name: "Fresh Co", ad_creative_link_titles: ["New thing"], ad_delivery_start_time: "2026-11-10" },
      { id: "a", page_id: "2", page_name: "Selure", ad_creative_link_titles: ["Posture Bands Built In"], ad_delivery_start_time: "2026-09-01", eu_total_reach: 52000 },
      { id: "b", page_id: "2", page_name: "Selure", ad_creative_link_titles: ["posture bands built in"], ad_delivery_start_time: "2026-09-03" },
      { id: "c", page_id: "2", page_name: "Selure", ad_creative_link_titles: ["Posture Bands Built In"], ad_delivery_start_time: "2026-09-05" },
    ], now);
    expect(ads.map((ad) => ad.id)).toEqual(["a", "new"]);
    expect(ads[0]).toMatchObject({ page: "Selure", versions: 3, daysRunning: 73, reach: 52000, url: "https://www.facebook.com/ads/library/?id=a" });
  });

  it("explains what's missing instead of failing", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "");
    expect(await searchMetaAds("lamp")).toMatchObject({ status: "not_configured" });

    vi.stubEnv("META_ACCESS_TOKEN", "meta-token");
    const fetch = vi.fn(async () => Response.json({ error: { code: 10, error_subcode: 2332002, message: "Application does not have permission" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    expect(await searchMetaAds("lamp")).toMatchObject({ status: "not_approved" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("ads_archive?search_terms=lamp");
    expect(url).not.toContain("meta-token");
    expect(init.headers).toEqual({ Authorization: "Bearer meta-token" });

    fetch.mockImplementation(async () => Response.json({ error: { code: 190 } }, { status: 400 }));
    expect(await searchMetaAds("lamp")).toMatchObject({ status: "token_expired" });
  });

  it("asks Meta for older ads and one media type, and ignores unknown filters", async () => {
    vi.stubEnv("META_ACCESS_TOKEN", "meta-token");
    const fetch = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    const now = Date.parse("2026-11-17T12:00:00Z");
    await searchMetaAds("lamp", { minDays: 30, media: "VIDEO" }, now);
    const filtered = new URL((fetch.mock.calls[0] as unknown as [string])[0]).searchParams;
    expect(filtered.get("ad_delivery_date_max")).toBe("2026-10-18");
    expect(filtered.get("media_type")).toBe("VIDEO");

    await searchMetaAds("lamp", { minDays: 45, media: "MEME" } as never, now);
    const plain = new URL((fetch.mock.calls[1] as unknown as [string])[0]).searchParams;
    expect(plain.has("ad_delivery_date_max")).toBe(false);
    expect(plain.has("media_type")).toBe(false);
  });

  it("counts the pages running the same text, whatever the emoji or spacing", () => {
    const copy = "Stand Taller & Feel More Supported! Improve your daily posture";
    const ads = summariseAds([
      { id: "1", page_id: "p1", page_name: "Bamaxisboon", ad_creative_bodies: [`💪✨ ${copy}`], ad_delivery_start_time: "2026-11-15" },
      { id: "2", page_id: "p2", page_name: "Comparisonk", ad_creative_bodies: [copy.toUpperCase()], ad_delivery_start_time: "2026-11-16" },
      { id: "3", page_id: "p3", page_name: "Other", ad_creative_bodies: ["Something different entirely, about lamps"], ad_delivery_start_time: "2026-11-16" },
      { id: "4", page_id: "p4", page_name: "Short", ad_creative_bodies: ["Buy now"] },
      { id: "5", page_id: "p5", page_name: "Short too", ad_creative_bodies: ["Buy now"] },
    ], Date.parse("2026-11-17T12:00:00Z"));
    const byId = Object.fromEntries(ads.map((ad) => [ad.id, ad]));
    expect(byId["1"].pages).toBe(2);
    expect(byId["1"].copyKey).toBe(byId["2"].copyKey);
    expect(byId["3"].pages).toBe(1);
    // Short text isn't evidence of one seller, so it isn't grouped.
    expect(byId["4"].copyKey).not.toBe(byId["5"].copyKey);
  });
});

describe("CJ Dropshipping", () => {
  it("reads CJ prices and product links", () => {
    expect(toCents("0.95 -- 1.53")).toBe(95);
    expect(toCents("0.95-1.53")).toBe(95);
    expect(toCents(6.49)).toBe(649);
    expect(toCents("free")).toBeNull();
    expect(cjProductUrl("Magnetic Therapy Belt Posture Corrector!", "DC8C-1")).toBe("https://cjdropshipping.com/product/magnetic-therapy-belt-posture-corrector-p-DC8C-1.html");
  });

  it("finds the cheapest variant and US shipping, reusing one saved token", async () => {
    vi.stubEnv("CJ_API_KEY", "CJ123@api@key");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      calls.push(input.replace("https://developers.cjdropshipping.com/api2.0/v1", ""));
      if (input.endsWith("/authentication/getAccessToken")) return Response.json({ code: 200, result: true, data: { accessToken: "tok-1", accessTokenExpiryDate: "2027-05-12T07:11:03+08:00" } });
      expect((init?.headers as Record<string, string>)["CJ-Access-Token"]).toBe("tok-1");
      if (input.includes("/product/query")) return Response.json({ code: 200, result: true, data: { pid: "DC8C-1", productNameEn: "Posture Belt", bigImage: "https://cf.cjdropshipping.com/a.jpg", sellPrice: "0.95-1.53", variants: [{ vid: "v2", variantSellPrice: 1.53 }, { vid: "v1", variantSellPrice: 0.95 }] } });
      if (input.includes("/logistic/freightCalculate")) {
        expect(JSON.parse(String(init?.body))).toEqual({ startCountryCode: "CN", endCountryCode: "US", products: [{ quantity: 1, vid: "v1" }] });
        return Response.json({ code: 200, result: true, data: [{ logisticName: "USPS+", logisticPrice: 7.1, logisticAging: "4-8" }, { logisticName: "CJPacket", logisticPrice: 6.49, logisticAging: "5-11" }] });
      }
      throw new Error(`Unexpected ${input}`);
    }));
    expect(await cjDetail("DC8C-1")).toMatchObject({ source: "cj", name: "Posture Belt", cost: 95, shipping: 649, shippingName: "CJPacket", days: "5-11 days", variants: 2, shipsFrom: "CN", stock: null, usStock: null });
    await cjDetail("DC8C-1");
    expect(calls.filter((call) => call.includes("getAccessToken"))).toHaveLength(1);
    expect(state.integration_tokens[0]).toMatchObject({ provider: "cj", access_token: "tok-1" });
    await expect(cjDetail("../etc")).rejects.toThrow("isn't valid");
  });

  it("quotes from CJ's US warehouse when it holds the variant, falls back to China, and waits out a rate limit", async () => {
    vi.stubEnv("CJ_API_KEY", "CJ123@api@key");
    const origins: string[] = [];
    let usQuotes: unknown[] = [{ logisticName: "USPS", logisticPrice: 4.2, logisticAging: "2-5" }];
    let limited = true;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith("/authentication/getAccessToken")) return Response.json({ code: 200, result: true, data: { accessToken: "tok-1", accessTokenExpiryDate: "2027-05-12T07:11:03+08:00" } });
      if (input.includes("/product/query")) {
        if (limited) { limited = false; return Response.json({ code: 1600200, result: false, message: "Too many requests" }, { status: 429 }); }
        // As CJ really answers: no stock on product/query, which comes from getInventoryByPid instead.
        return Response.json({ code: 200, result: true, data: { pid: "P1", productNameEn: "Galaxy Projector", sellPrice: 9.5, variants: [
          { vid: "v1", variantSellPrice: 9.5, inventories: null }, { vid: "v2", variantSellPrice: 11, inventories: null },
        ] } });
      }
      if (input.includes("/product/stock/getInventoryByPid")) return Response.json({ code: 200, result: true, data: {
        inventories: [{ countryCode: "US", totalInventoryNum: 40 }, { countryCode: "CN", totalInventoryNum: 100 }],
        variantInventories: [
          { vid: "v1", inventory: [{ countryCode: "US", totalInventory: 40 }, { countryCode: "CN", totalInventory: "100" }] },
          { vid: "v2", inventory: [{ countryCode: "CN", totalInventory: 0 }] },
        ],
      } });
      if (input.includes("/logistic/freightCalculate")) {
        const body = JSON.parse(String(init?.body));
        origins.push(body.startCountryCode);
        return Response.json({ code: 200, result: true, data: body.startCountryCode === "US" ? usQuotes : [{ logisticName: "CJPacket", logisticPrice: 6.49, logisticAging: "8-15" }] });
      }
      throw new Error(`Unexpected ${input}`);
    }));
    expect(await cjDetail("P1")).toMatchObject({ cost: 950, shipping: 420, shippingName: "USPS (US warehouse)", days: "2-5 days", shipsFrom: "US", stock: 140, usStock: 40 });
    expect(origins).toEqual(["US"]);

    usQuotes = [];
    expect(await cjDetail("P1")).toMatchObject({ shipping: 649, shippingName: "CJPacket", shipsFrom: "CN" });
    expect(origins).toEqual(["US", "US", "CN"]);
    expect(cjNotes({ listed: 1200 }, { stock: 140, usStock: 40, shipsFrom: "US" })).toBe("Listed by 1,200 stores on CJ. 140 in stock at CJ, 40 in its US warehouse. Shipping quoted from CJ's US warehouse.");
    expect(cjNotes({ listed: null }, { stock: 0, usStock: 0, shipsFrom: null })).toBe("CJ is out of stock.");
  });

  it("searches only CJ's US warehouses when asked, with stock and delivery days", async () => {
    vi.stubEnv("CJ_API_KEY", "CJ123@api@key");
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.endsWith("/authentication/getAccessToken")) return Response.json({ code: 200, result: true, data: { accessToken: "tok-1", accessTokenExpiryDate: "2027-05-12T07:11:03+08:00" } });
      urls.push(new URL(input));
      return Response.json({ code: 200, result: true, data: { content: [{ productList: [{ id: "P1", nameEn: "Lamp", sellPrice: "3.20-4.10", warehouseInventoryNum: 812, deliveryCycle: "5" }] }] } });
    }));
    expect(await searchCj("lamp", true)).toEqual([expect.objectContaining({ id: "P1", cost: 320, stock: 812, deliveryDays: 5, usStock: true })]);
    expect(urls[0].searchParams.get("countryCode")).toBe("US");
    await searchCj("lamp");
    expect(urls[1].searchParams.has("countryCode")).toBe(false);
  });
});
