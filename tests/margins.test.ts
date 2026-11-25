import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedPhysicalOrder, seedPhysicalStore, state } from "./fakes";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));
const cj = vi.hoisted(() => ({ prices: new Map<string, { vid: string; sku: string | null; cost: number; stock?: number | null }[] | null>(), fail: false }));
vi.mock("../lib/cj", async (original) => ({
  ...(await original<typeof import("../lib/cj")>()),
  cjConfigured: () => true,
  cjVariantPrices: async (pid: string) => {
    if (cj.fail) throw new Error("Couldn't reach CJ");
    return cj.prices.has(pid) ? cj.prices.get(pid)! : null;
  },
}));

import { POST as marginsApi } from "../app/api/admin/margins/route";
import { POST as fulfillmentApi } from "../app/api/admin/fulfillment/route";
import { checkCjPrices, checkDue, listMarginRows, summarize, supplierOf, unitMargin } from "../lib/margins";
import { cjPidFromUrl } from "../lib/cj";

const ORIGIN = "https://delivery.example.com";
const json = (url: string, body: unknown) => new Request(`${ORIGIN}${url}`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const BLACK = "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b01";
const WHITE = "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b02";

beforeEach(() => { resetFakes(); jar.clear(); jar.set("veilcode_owner", "owner-token"); cj.prices.clear(); cj.fail = false; vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("margin maths", () => {
  it("counts supplier cost, supplier shipping and card fees", () => {
    // 49.00 - 15.00 - 4.00 - (1.42 + 0.30) = 28.28
    expect(unitMargin(4900, 1500, 400)).toEqual({ profit: 2828, margin: 2828 / 4900 });
    expect(unitMargin(4900, null, 400)).toEqual({ profit: null, margin: null });
  });
  it("knows suppliers and when a manual check is due", () => {
    expect(supplierOf("https://www.aliexpress.com/item/1005.html")).toBe("aliexpress");
    expect(supplierOf("https://cjdropshipping.com/product/lamp-p-ABC-123.html")).toBe("cj");
    expect(cjPidFromUrl("https://cjdropshipping.com/product/lamp-p-ABC-123.html")).toBe("ABC-123");
    expect(cjPidFromUrl("https://evil.example/product/lamp-p-ABC.html")).toBeNull();
    expect(checkDue({ supplier_url: "https://www.aliexpress.com/item/1.html", supplier_checked_at: null })).toBe(true);
    expect(checkDue({ supplier_url: "https://www.aliexpress.com/item/1.html", supplier_checked_at: new Date().toISOString() })).toBe(false);
    expect(checkDue({ supplier_url: "https://cjdropshipping.com/product/x-p-1.html", supplier_checked_at: null })).toBe(false);
  });
});

describe("the margins page", () => {
  it("lists every variant, flags what needs attention and saves costs", async () => {
    seedPhysicalStore();
    let rows = await listMarginRows();
    expect(rows).toHaveLength(2);
    expect(summarize(rows)).toMatchObject({ missingCost: 2, belowTarget: 0, checksDue: 2 });

    expect((await marginsApi(json("/api/admin/margins", { action: "cost", variantId: BLACK, unitCost: "30", supplierShipping: "6" }))).status).toBe(200);
    expect((await marginsApi(json("/api/admin/margins", { action: "cost", variantId: WHITE, unitCost: "-1" }))).status).toBe(400);
    expect((await marginsApi(json("/api/admin/margins", { action: "checked", variantId: WHITE }))).status).toBe(200);
    rows = await listMarginRows();
    const black = rows.find((row) => row.variantId === BLACK)!;
    expect(black).toMatchObject({ unitCost: 3000, supplierShipping: 600, costSource: "manual", checkDue: false });
    expect(black.margin).toBeLessThan(0.3);
    expect(summarize(rows)).toMatchObject({ missingCost: 1, belowTarget: 1, checksDue: 0 });

    jar.clear();
    expect((await marginsApi(json("/api/admin/margins", { action: "checked", variantId: WHITE }))).status).toBe(401);
  });

  it("learns the real cost when an order is marked as ordered", async () => {
    seedPhysicalStore();
    state.product_variants[0].supplier_shipping = 300;
    state.product_variants[0].unit_cost = 1000;
    const order = seedPhysicalOrder();
    order.physical_snapshot!.items[0].variantId = BLACK;
    // Two units for 32.00 in total: 16.00 each, of which 3.00 is the supplier's shipping.
    expect((await fulfillmentApi(json("/api/admin/fulfillment", { orderId: order.id, expected: "needs_ordering", action: "ordered", supplierRef: "AE 1", supplierCost: "32.00" }))).status).toBe(200);
    expect(state.orders[0].supplier_cost).toBe(3200);
    expect(state.product_variants[0]).toMatchObject({ unit_cost: 1300, cost_source: "order" });
    expect(state.product_variants[0].supplier_alert).toMatch(/up from 13\.00/);
    expect((await fulfillmentApi(json("/api/admin/fulfillment", { orderId: order.id, expected: "ordered", action: "ordered", supplierCost: "abc" }))).status).toBe(400);
  });

  it("re-prices CJ variants daily and raises an alert when CJ gets dearer or drops the product", async () => {
    seedPhysicalStore();
    state.product_variants[0].supplier_url = "https://cjdropshipping.com/product/lamp-p-PID1.html";
    state.product_variants[0].supplier_sku = "VID-BLACK";
    state.product_variants[0].unit_cost = 1000;
    state.product_variants[1].supplier_url = "https://cjdropshipping.com/product/gone-p-PID2.html";
    cj.prices.set("PID1", [{ vid: "VID-WHITE", sku: null, cost: 900 }, { vid: "VID-BLACK", sku: null, cost: 1200 }]);
    expect(await checkCjPrices()).toEqual({ checked: 2, alerts: 2 });
    expect(state.product_variants[0]).toMatchObject({ supplier_price_seen: 1200, unit_cost: 1000 });
    expect(state.product_variants[0].supplier_alert).toMatch(/CJ now charges 12\.00, up from 10\.00/);
    expect(state.product_variants[1].supplier_alert).toBe("CJ no longer lists this product.");

    cj.prices.set("PID1", [{ vid: "VID-BLACK", sku: null, cost: 1020 }]);
    cj.prices.set("PID2", [{ vid: "X", sku: null, cost: 800 }]);
    expect(await checkCjPrices()).toEqual({ checked: 2, alerts: 0 });
    expect(state.product_variants[1]).toMatchObject({ unit_cost: 800, cost_source: "cj", supplier_alert: null });
  });

  it("flags stock running low or out, and variants it can't match, without guessing a price", async () => {
    seedPhysicalStore();
    const [black, white] = state.product_variants;
    black.supplier_url = white.supplier_url = "https://cjdropshipping.com/product/lamp-p-PID1.html";
    black.supplier_sku = "cj-black-sku"; black.unit_cost = 1000;
    white.supplier_sku = null; white.unit_cost = 900;
    cj.prices.set("PID1", [{ vid: "V1", sku: "CJ-BLACK-SKU", cost: 1000, stock: 0 }, { vid: "V2", sku: "CJ-WHITE-SKU", cost: 700, stock: 500 }]);
    expect(await checkCjPrices()).toEqual({ checked: 2, alerts: 2 });
    expect(black.supplier_alert).toBe("CJ is out of stock of this variant.");
    expect(white).toMatchObject({ supplier_price_seen: null, unit_cost: 900 });
    expect(white.supplier_alert).toMatch(/Can't tell which CJ variant/);

    cj.prices.set("PID1", [{ vid: "V1", sku: "CJ-BLACK-SKU", cost: 1100, stock: 12 }, { vid: "V2", sku: "CJ-WHITE-SKU", cost: 700, stock: 500 }]);
    white.supplier_sku = "V2";
    expect(await checkCjPrices()).toEqual({ checked: 2, alerts: 1 });
    expect(black.supplier_alert).toBe("CJ now charges 11.00, up from 10.00. CJ has only 12 left.");
    expect(white.supplier_alert).toBeNull();
  });

  it("checks the products seen longest ago first, and a failed call never reads as a dropped product", async () => {
    seedPhysicalStore();
    const [black, white] = state.product_variants;
    black.supplier_url = "https://cjdropshipping.com/product/a-p-PID1.html";
    white.supplier_url = "https://cjdropshipping.com/product/b-p-PID2.html";
    black.supplier_checked_at = new Date(Date.now() - 3600_000).toISOString();
    white.supplier_checked_at = new Date(Date.now() - 86400_000).toISOString();
    cj.prices.set("PID1", [{ vid: "A", sku: null, cost: 500 }]);
    cj.prices.set("PID2", [{ vid: "B", sku: null, cost: 600 }]);
    expect(await checkCjPrices(1)).toEqual({ checked: 1, alerts: 0 });
    expect(white.supplier_price_seen).toBe(600);
    expect(black.supplier_price_seen ?? null).toBeNull();

    cj.fail = true;
    const before = { ...black };
    expect(await checkCjPrices()).toEqual({ checked: 0, alerts: 0 });
    expect(black).toEqual(before);
  });
});
