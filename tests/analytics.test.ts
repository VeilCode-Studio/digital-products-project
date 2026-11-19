import { describe, expect, it } from "vitest";
import { computeAnalytics, granularityFor, parseFilters, periods, type AnalyticsCheckout, type AnalyticsOrder } from "../lib/analytics";

const NOW = new Date("2026-11-19T15:00:00Z");
let id = 0;
function order(day: string, amount: number, extra: Partial<AnalyticsOrder> = {}): AnalyticsOrder {
  id += 1;
  return { id: `o${id}`, product_id: "p1", email: `buyer${id}@example.com`, amount_total: amount, currency: "usd", created_at: `${day}T12:00:00Z`, kind: "digital",
    product_snapshot: { name: "Guide", shortName: "Guide", emailSubject: "", storagePath: "", downloadFilename: "", templatesUrl: null },
    physical_snapshot: null, shipping_address: null, fulfillment_status: null, shipped_at: null, cancelled_at: null, refunded_amount: null, ...extra };
}
const checkout = (day: string, extra: Partial<AnalyticsCheckout> = {}): AnalyticsCheckout => ({ id: `c${day}${Math.random()}`, product_id: "p1", created_at: `${day}T10:00:00Z`, kind: "digital", expired_at: null, recovered_at: null, stripe_session_id: null, ...extra });

describe("analytics filters", () => {
  it("defaults to the last 30 days of everything", () => {
    expect(parseFilters({}, NOW)).toEqual({ range: "30d", from: "2026-10-21", to: "2026-11-19", kind: "all", product: "all" });
  });
  it("accepts a custom range, orders it, and stops at today", () => {
    expect(parseFilters({ range: "custom", from: "2026-12-30", to: "2026-11-01" }, NOW)).toMatchObject({ range: "custom", from: "2026-11-01", to: "2026-11-19" });
    expect(parseFilters({ range: "custom", from: "nonsense", to: "2026-11-01" }, NOW).range).toBe("30d");
  });
  it("ignores unknown values", () => {
    expect(parseFilters({ range: "5y", kind: "both", product: "<script>" }, NOW)).toMatchObject({ range: "30d", kind: "all", product: "all" });
  });
  it("picks a bucket size the chart can show", () => {
    expect(granularityFor(30)).toBe("day");
    expect(granularityFor(90)).toBe("week");
    expect(granularityFor(365)).toBe("month");
    expect(periods(parseFilters({ range: "7d" }, NOW)).days).toBe(7);
  });
});

describe("computeAnalytics", () => {
  const filters = parseFilters({ range: "7d" }, NOW); // 13 to 19 November; the previous period is 6 to 12 November.

  it("totals the period, compares it with the one before, and charts each day", () => {
    const data = computeAnalytics([order("2026-11-13", 2000), order("2026-11-19", 3000, { refunded_amount: 1000 }), order("2026-11-10", 2500), order("2026-10-01", 9999)], [], filters);
    expect(data.kpis.revenue).toEqual({ value: 5000, previous: 2500, change: 1 });
    expect(data.kpis.net.value).toBe(4000);
    expect(data.kpis.orders.value).toBe(2);
    expect(data.kpis.aov.value).toBe(2500);
    expect(data.trend).toHaveLength(7);
    expect(data.trend[0]).toMatchObject({ key: "2026-11-13", revenue: 2000, orders: 1 });
    expect(data.trend[4]).toMatchObject({ key: "2026-11-17", previousRevenue: 2500 });
    expect(data.refunds).toEqual({ amount: 1000, orders: 1 });
  });

  it("filters by type and product, and ranks products by revenue", () => {
    const physical = order("2026-11-15", 4500, { kind: "physical", product_id: "p2", physical_snapshot: { brand: { name: "", supportEmail: null }, currency: "usd", shippingOptions: [], items: [{ productId: "p2", variantId: "v", name: "Lamp", variantLabel: "", sku: null, unitAmount: 1500, quantity: 3, imagePath: null, supplierUrl: null, supplierSku: null }] }, shipping_address: { name: null, line1: null, line2: null, city: null, state: "CA", postal_code: null, country: "US", phone: null }, shipped_at: "2026-11-16T12:00:00Z" });
    const orders = [order("2026-11-14", 2000), physical];
    const all = computeAnalytics(orders, [], filters);
    expect(all.products.map((product) => product.name)).toEqual(["Lamp", "Guide"]);
    expect(all.kpis.units.value).toBe(4);
    expect(all.split).toEqual({ digital: 2000, physical: 4500 });
    expect(all.regions).toEqual([{ name: "CA", orders: 1, revenue: 4500 }]);
    expect(all.fulfilment).toMatchObject({ physicalOrders: 1, shipped: 1, medianHoursToShip: 24 });
    expect(computeAnalytics(orders, [], { ...filters, kind: "digital" }).kpis.revenue.value).toBe(2000);
    expect(computeAnalytics(orders, [], { ...filters, product: "p2" }).kpis.orders.value).toBe(1);
  });

  it("reports the checkout funnel and repeat customers", () => {
    const data = computeAnalytics([order("2026-11-14", 1000, { email: "a@example.com" }), order("2026-11-15", 1000, { email: "A@example.com " })],
      [checkout("2026-11-14"), checkout("2026-11-15"), checkout("2026-11-16", { expired_at: "2026-11-17T10:00:00Z" }), checkout("2026-11-16", { recovered_at: "2026-11-17T10:00:00Z" })], filters);
    expect(data.funnel).toEqual({ started: 4, paid: 2, abandoned: 1, recovered: 1, conversion: 0.5 });
    expect(data.customers).toEqual({ unique: 1, repeat: 1, repeatRate: 1 });
  });

  it("reports in the main currency and names the others", () => {
    const data = computeAnalytics([order("2026-11-14", 5000), order("2026-11-14", 1000, { currency: "gbp" })], [], filters);
    expect(data.currency).toBe("usd");
    expect(data.otherCurrencies).toEqual(["gbp"]);
    expect(data.kpis.revenue.value).toBe(5000);
  });

  it("marks growth from nothing as new rather than infinite", () => {
    expect(computeAnalytics([order("2026-11-14", 5000)], [], filters).kpis.revenue.change).toBeNull();
    expect(computeAnalytics([], [], filters).kpis.revenue.change).toBe(0);
  });
});
