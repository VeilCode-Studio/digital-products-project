import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedPhysicalOrder, seedPhysicalStore, sendEmail, state } from "./fakes";
import { stubDevelopment } from "./env";
import type { CjOrderInput, CjOrderState, CjQuote, CjVariantPrice } from "../lib/cj";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));
const cj = vi.hoisted(() => ({
  prices: new Map<string, CjVariantPrice[] | null>(),
  quotes: [] as CjQuote[], quotedFrom: [] as string[], balance: 10_000,
  created: [] as CjOrderInput[], createError: null as Error | null,
  details: new Map<string, CjOrderState | null>(),
}));
vi.mock("../lib/cj", async (original) => ({
  ...(await original<typeof import("../lib/cj")>()),
  cjConfigured: () => true,
  cjVariantPrices: async (pid: string) => cj.prices.has(pid) ? cj.prices.get(pid)! : null,
  cjShippingQuotes: async (from: string) => { cj.quotedFrom.push(from); return cj.quotes; },
  cjBalance: async () => cj.balance,
  cjCreateOrder: async (input: CjOrderInput) => {
    if (cj.createError) throw cj.createError;
    cj.created.push(input);
    return { orderId: "CJ2611250000000001", productAmount: 1840, postageAmount: 609, status: "UNSHIPPED" };
  },
  cjOrderDetail: async (id: string) => cj.details.get(id) ?? null,
}));

import { POST as cjApi } from "../app/api/admin/fulfillment/cj/route";
import { suggestMethod, syncCjOrders } from "../lib/cj-orders";
import { HttpError } from "../lib/http";

const ORIGIN = "https://delivery.example.com";
const STAGING = "https://staging.example.com";
const call = async (body: Record<string, unknown>, origin = ORIGIN) => {
  const response = await cjApi(new Request(`${origin}/api/admin/fulfillment/cj`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }));
  return { status: response.status, body: await response.json() };
};
const BLACK = "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b01";
const QUOTES: CjQuote[] = [
  { name: "CJPacket Ordinary", cost: 609, minDays: 4, maxDays: 9 },
  { name: "USPS+", cost: 574, minDays: 3, maxDays: 7 },
].sort((a, b) => a.cost - b.cost);

/** A paid order for two Black lamps, linked to CJ product PID1 / variant VID-B. */
function cjOrder() {
  seedPhysicalStore();
  state.product_variants[0].supplier_url = "https://cjdropshipping.com/product/lamp-p-PID1.html";
  state.product_variants[0].supplier_sku = "VID-B";
  const order = seedPhysicalOrder();
  order.physical_snapshot!.items[0].variantId = BLACK;
  return order;
}

beforeEach(() => {
  resetFakes(); jar.clear(); jar.set("veilcode_owner", "owner-token");
  Object.assign(cj, { quotes: QUOTES, quotedFrom: [], balance: 10_000, created: [], createError: null });
  cj.prices.clear(); cj.details.clear();
  cj.prices.set("PID1", [{ vid: "VID-B", sku: "CJ-B", cost: 920, stock: 300, usStock: 0 }, { vid: "VID-W", sku: "CJ-W", cost: 950, stock: 10, usStock: 0 }]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ordering from CJ", () => {
  it("prices an order without placing it, suggesting the cheapest method within the promise", async () => {
    const order = cjOrder();
    const { status, body } = await call({ action: "plan", orderId: order.id });
    expect(status).toBe(200);
    // The buyer was promised up to 6 business days: USPS+ is cheaper but takes up to 7, so neither fits; the fastest is suggested.
    expect(body.plan).toMatchObject({ from: "CN", productTotal: 1840, balance: 10_000, sandbox: false, problems: [], suggested: "USPS+", promisedDays: 6 });
    expect(body.plan.lines[0]).toMatchObject({ vid: "VID-B", quantity: 2, unitCost: 920 });
    expect(cj.created).toEqual([]);
    expect(suggestMethod(QUOTES, 9)).toBe("USPS+");
    expect(suggestMethod([{ name: "Slow", cost: 100, minDays: 10, maxDays: 20 }, { name: "Fast", cost: 900, minDays: 2, maxDays: 5 }], 6)).toBe("Fast");
  });

  it("ships from the US warehouse only when it holds every unit", async () => {
    const order = cjOrder();
    cj.prices.set("PID1", [{ vid: "VID-B", sku: null, cost: 920, stock: 300, usStock: 2 }]);
    expect((await call({ action: "plan", orderId: order.id })).body.plan.from).toBe("US");
    cj.prices.set("PID1", [{ vid: "VID-B", sku: null, cost: 920, stock: 300, usStock: 1 }]);
    expect((await call({ action: "plan", orderId: order.id })).body.plan.from).toBe("CN");
  });

  it("places the order, records CJ's code and cost, and learns the variant's cost", async () => {
    const order = cjOrder();
    const { status, body } = await call({ action: "place", orderId: order.id, logisticName: "USPS+" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ cjOrderId: "CJ2611250000000001", cost: 2449, sandbox: false });
    expect(body.message).toMatch(/Placed and paid/);
    expect(cj.created[0]).toMatchObject({
      orderNumber: order.id, logisticName: "USPS+", from: "CN", sandbox: false,
      address: { name: "Ada Lovelace", line1: "1 Main St", city: "Austin", state: "Texas", zip: "73301" },
      products: [{ vid: "VID-B", quantity: 2 }],
    });
    expect(state.orders[0]).toMatchObject({ fulfillment_status: "ordered", supplier_order_ref: "CJ2611250000000001", supplier_cost: 2449 });
    expect(state.product_variants[0].cost_source).toBe("order");
    // Placed once only.
    expect((await call({ action: "place", orderId: order.id, logisticName: "USPS+" })).status).toBe(409);
    expect(cj.created).toHaveLength(1);
  });

  it("refuses what it can't place: unmatched variants, low stock, short balance, unknown methods", async () => {
    const order = cjOrder();
    expect((await call({ action: "place", orderId: order.id, logisticName: "Teleport" })).body.error).toMatch(/isn't available/);
    cj.balance = 1000;
    expect((await call({ action: "place", orderId: order.id, logisticName: "USPS+" })).body.error).toMatch(/balance is \$10\.00; this order needs about \$24\.14/);
    cj.balance = 10_000;
    cj.prices.set("PID1", [{ vid: "VID-B", sku: null, cost: 920, stock: 1, usStock: 0 }]);
    expect((await call({ action: "place", orderId: order.id, logisticName: "USPS+" })).body.error).toMatch(/CJ has 1 of Glow Lamp in stock/);
    state.product_variants[0].supplier_sku = null;
    cj.prices.set("PID1", [{ vid: "VID-B", sku: null, cost: 920 }, { vid: "VID-W", sku: null, cost: 950 }]);
    expect((await call({ action: "plan", orderId: order.id })).body.plan.problems[0]).toMatch(/Can't tell which CJ variant/);
    expect(cj.created).toEqual([]);
    expect(state.orders[0]).toMatchObject({ fulfillment_status: "needs_ordering", supplier_order_ref: null });
  });

  it("releases the order when CJ says no, but holds it when CJ doesn't answer", async () => {
    const order = cjOrder();
    cj.createError = new HttpError(502, "CJ: Address invalid");
    expect((await call({ action: "place", orderId: order.id, logisticName: "USPS+" })).body.error).toBe("CJ: Address invalid");
    expect(state.orders[0]).toMatchObject({ supplier_order_ref: null, ordered_at: null });

    cj.createError = new HttpError(504, "Couldn't reach CJ.");
    expect((await call({ action: "place", orderId: order.id, logisticName: "USPS+" })).body.error).toMatch(/may or may not have been placed/);
    expect(state.orders[0].supplier_order_ref).toBe("CJ: placing…");
    const plan = (await call({ action: "plan", orderId: order.id })).body.plan;
    expect(plan.problems).toContain("A CJ order is being placed for this order right now.");
  });

  it("places unpaid sandbox orders outside production", async () => {
    stubDevelopment({ VERCEL: "1", VERCEL_ENV: "preview", DEPLOYMENT_ENV: "preview", APP_URL: "https://staging.example.com" });
    const order = cjOrder();
    const plan = await call({ action: "plan", orderId: order.id }, STAGING);
    expect(plan.status).toBe(200);
    expect(plan.body.plan).toMatchObject({ sandbox: true, balance: null });
    const placed = await call({ action: "place", orderId: order.id, logisticName: "USPS+" }, STAGING);
    expect(placed.body.message).toMatch(/sandbox order/);
    expect(cj.created[0].sandbox).toBe(true);
  });

  it("needs the owner", async () => {
    jar.clear();
    expect((await call({ action: "plan", orderId: "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b09" })).status).toBe(401);
  });
});

describe("following CJ orders", () => {
  it("adds tracking and emails the buyer, then marks delivered, leaving other suppliers alone", async () => {
    const order = cjOrder();
    Object.assign(order, { fulfillment_status: "ordered", supplier_order_ref: "CJ2611250000000001" });
    const other = seedPhysicalOrder({ fulfillment_status: "ordered", supplier_order_ref: "AliExpress order 8123" });
    cj.details.set("CJ2611250000000001", { status: "SHIPPED", trackNumber: "92001234567890", trackingUrl: null, carrier: "USPS", amount: 2449 });

    expect(await syncCjOrders()).toEqual({ checked: 1, shipped: 1, delivered: 0 });
    expect(state.orders.find((row) => row.id === order.id)).toMatchObject({ fulfillment_status: "shipped", tracking_number: "92001234567890", tracking_carrier: "USPS" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(other.fulfillment_status).toBe("ordered");

    // Same tracking again: nothing new, no second email.
    expect(await syncCjOrders()).toEqual({ checked: 1, shipped: 0, delivered: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    cj.details.set("CJ2611250000000001", { status: "DELIVERED", trackNumber: "92001234567890", trackingUrl: null, carrier: "USPS", amount: 2449 });
    expect(await syncCjOrders()).toEqual({ checked: 1, shipped: 0, delivered: 1 });
    expect(state.orders.find((row) => row.id === order.id)!.fulfillment_status).toBe("delivered");
  });
});
