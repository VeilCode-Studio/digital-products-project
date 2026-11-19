// Store analytics (app/admin/(workspace)/analytics). Everything is worked out from paid orders and
// checkout attempts; dates are UTC, like the rest of the workspace. The maths lives in computeAnalytics
// so it can be checked without a database.
import type { Order } from "./database.types";
import type { Checkout } from "./catalog.types";

export const RANGES = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "12m": "Last 12 months", custom: "Custom range" } as const;
export type RangeKey = keyof typeof RANGES;
export type KindFilter = "all" | "digital" | "physical";
export type Filters = { range: RangeKey; from: string; to: string; kind: KindFilter; product: string };
export type Granularity = "day" | "week" | "month";

const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (date: Date) => date.toISOString().slice(0, 10);
const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Reads the filters from the page's query string, falling back to the last 30 days of everything. */
export function parseFilters(query: Record<string, string | string[] | undefined>, now = new Date()): Filters {
  const range = (first(query.range) in RANGES ? first(query.range) : "30d") as RangeKey;
  const kind = (["digital", "physical"].includes(first(query.kind)) ? first(query.kind) : "all") as KindFilter;
  const product = /^[\w-]{1,80}$/.test(first(query.product)) ? first(query.product) : "all";
  const today = startOfDay(now);
  const custom = range === "custom" && ISO_DATE.test(first(query.from)) && ISO_DATE.test(first(query.to));
  let from: Date, to: Date;
  if (custom) {
    from = new Date(`${first(query.from)}T00:00:00Z`); to = new Date(`${first(query.to)}T00:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) { from = new Date(today.getTime() - 29 * DAY); to = today; }
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    // Two years is plenty for a chart and keeps the query bounded.
    if (to.getTime() - from.getTime() > 730 * DAY) from = new Date(to.getTime() - 730 * DAY);
  } else {
    to = today;
    const days = range === "7d" ? 7 : range === "90d" ? 90 : range === "12m" ? 365 : 30;
    from = new Date(today.getTime() - (days - 1) * DAY);
  }
  return { range: range === "custom" && !custom ? "30d" : range, from: ymd(from), to: ymd(to), kind, product };
}

/** The selected period as [start, end) timestamps, and the equally long period just before it. */
export function periods(filters: Filters) {
  const start = new Date(`${filters.from}T00:00:00Z`).getTime();
  const end = new Date(`${filters.to}T00:00:00Z`).getTime() + DAY;
  const length = end - start;
  return { start, end, prevStart: start - length, prevEnd: start, days: Math.round(length / DAY) };
}

export function granularityFor(days: number): Granularity {
  return days <= 45 ? "day" : days <= 200 ? "week" : "month";
}

/** The start of the bucket a moment falls in. Weeks start on Monday. */
function bucketStart(time: number, granularity: Granularity) {
  const date = startOfDay(new Date(time));
  if (granularity === "week") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  if (granularity === "month") date.setUTCDate(1);
  return date.getTime();
}
function nextBucket(time: number, granularity: Granularity) {
  const date = new Date(time);
  if (granularity === "day") date.setUTCDate(date.getUTCDate() + 1);
  else if (granularity === "week") date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime();
}

export type AnalyticsOrder = Pick<Order, "id" | "product_id" | "email" | "amount_total" | "currency" | "created_at" | "kind" | "product_snapshot" | "physical_snapshot" | "shipping_address" | "fulfillment_status" | "shipped_at" | "cancelled_at" | "refunded_amount">;
export type AnalyticsCheckout = Pick<Checkout, "id" | "product_id" | "created_at" | "kind" | "expired_at" | "recovered_at" | "stripe_session_id">;

export type TrendPoint = { key: string; label: string; revenue: number; orders: number; previousRevenue: number; previousOrders: number };
export type Metric = { value: number; previous: number; change: number | null };
export type ProductRow = { id: string; name: string; kind: "digital" | "physical"; orders: number; units: number; revenue: number; share: number };

export type Analytics = {
  currency: string;
  otherCurrencies: string[];
  granularity: Granularity;
  trend: TrendPoint[];
  kpis: { revenue: Metric; net: Metric; orders: Metric; aov: Metric; units: Metric; customers: Metric };
  products: ProductRow[];
  split: { digital: number; physical: number };
  weekdays: { label: string; revenue: number; orders: number }[];
  funnel: { started: number; paid: number; abandoned: number; recovered: number; conversion: number | null };
  customers: { unique: number; repeat: number; repeatRate: number | null };
  fulfilment: { physicalOrders: number; shipped: number; cancelled: number; medianHoursToShip: number | null };
  regions: { name: string; orders: number; revenue: number }[];
  refunds: { amount: number; orders: number };
};

const kindOf = (order: { kind?: "digital" | "physical" | null }) => (order.kind === "physical" ? "physical" : "digital");
const nameOf = (order: AnalyticsOrder) => order.physical_snapshot?.items[0]?.name ?? order.product_snapshot?.name ?? "Unnamed product";
const unitsOf = (order: AnalyticsOrder) => order.physical_snapshot?.items.reduce((sum, item) => sum + (item.quantity || 0), 0) || 1;
const change = (value: number, previous: number) => (previous ? (value - previous) / previous : value ? null : 0);
const metric = (value: number, previous: number): Metric => ({ value, previous, change: change(value, previous) });

/** Everything the analytics page shows, from orders covering both periods and the period's checkouts. */
export function computeAnalytics(allOrders: AnalyticsOrder[], allCheckouts: AnalyticsCheckout[], filters: Filters): Analytics {
  const { start, end, prevStart, days } = periods(filters);
  const wanted = (item: { kind?: "digital" | "physical" | null; product_id: string }) =>
    (filters.kind === "all" || kindOf(item) === filters.kind) && (filters.product === "all" || item.product_id === filters.product);
  const orders = allOrders.filter(wanted);
  const at = (order: { created_at: string }) => new Date(order.created_at).getTime();

  // Money is reported in the currency that sold the most this period; other currencies are named, not mixed in.
  const byCurrency = new Map<string, number>();
  for (const order of orders) if (order.currency && at(order) >= start && at(order) < end) byCurrency.set(order.currency, (byCurrency.get(order.currency) ?? 0) + (order.amount_total ?? 0));
  const ranked = [...byCurrency].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  const currency = ranked[0] ?? allOrders.find((order) => order.currency)?.currency ?? "usd";
  const inCurrency = orders.filter((order) => (order.currency ?? currency) === currency);
  const current = inCurrency.filter((order) => at(order) >= start && at(order) < end);
  const previous = inCurrency.filter((order) => at(order) >= prevStart && at(order) < start);

  const granularity = granularityFor(days);
  const label = new Intl.DateTimeFormat("en-US", granularity === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
  const trend: TrendPoint[] = [];
  const bucketIndex = new Map<number, number>();
  for (let time = bucketStart(start, granularity); time < end; time = nextBucket(time, granularity)) {
    bucketIndex.set(time, trend.length);
    trend.push({ key: ymd(new Date(time)), label: label.format(new Date(Math.max(time, start))), revenue: 0, orders: 0, previousRevenue: 0, previousOrders: 0 });
  }
  for (const order of current) {
    const point = trend[bucketIndex.get(bucketStart(at(order), granularity)) ?? -1];
    if (point) { point.revenue += order.amount_total ?? 0; point.orders += 1; }
  }
  // The previous period lines up bucket by bucket, shifted by exactly one period length.
  const shift = start - prevStart;
  for (const order of previous) {
    const point = trend[bucketIndex.get(bucketStart(at(order) + shift, granularity)) ?? -1];
    if (point) { point.previousRevenue += order.amount_total ?? 0; point.previousOrders += 1; }
  }

  const sum = (list: AnalyticsOrder[], pick: (order: AnalyticsOrder) => number) => list.reduce((total, order) => total + pick(order), 0);
  const gross = (list: AnalyticsOrder[]) => sum(list, (order) => order.amount_total ?? 0);
  const refunded = (list: AnalyticsOrder[]) => sum(list, (order) => order.refunded_amount ?? 0);
  const emails = (list: AnalyticsOrder[]) => new Set(list.map((order) => order.email.trim().toLowerCase()));
  const kpis = {
    revenue: metric(gross(current), gross(previous)),
    net: metric(gross(current) - refunded(current), gross(previous) - refunded(previous)),
    orders: metric(current.length, previous.length),
    aov: metric(current.length ? Math.round(gross(current) / current.length) : 0, previous.length ? Math.round(gross(previous) / previous.length) : 0),
    units: metric(sum(current, unitsOf), sum(previous, unitsOf)),
    customers: metric(emails(current).size, emails(previous).size),
  };

  const productMap = new Map<string, ProductRow>();
  for (const order of current) {
    const row = productMap.get(order.product_id) ?? { id: order.product_id, name: nameOf(order), kind: kindOf(order), orders: 0, units: 0, revenue: 0, share: 0 };
    row.orders += 1; row.units += unitsOf(order); row.revenue += order.amount_total ?? 0;
    productMap.set(order.product_id, row);
  }
  const revenue = kpis.revenue.value;
  const products = [...productMap.values()].map((row) => ({ ...row, share: revenue ? row.revenue / revenue : 0 })).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);

  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekdays = weekdayNames.map((name) => ({ label: name, revenue: 0, orders: 0 }));
  for (const order of current) { const entry = weekdays[(new Date(order.created_at).getUTCDay() + 6) % 7]; entry.revenue += order.amount_total ?? 0; entry.orders += 1; }

  const checkouts = allCheckouts.filter((checkout) => wanted(checkout) && at(checkout) >= start && at(checkout) < end);
  const abandoned = checkouts.filter((checkout) => checkout.expired_at && !checkout.recovered_at).length;
  const recovered = checkouts.filter((checkout) => checkout.recovered_at).length;
  const funnel = { started: checkouts.length, paid: current.length, abandoned, recovered, conversion: checkouts.length ? Math.min(1, current.length / checkouts.length) : null };

  const counts = new Map<string, number>();
  for (const order of current) { const email = order.email.trim().toLowerCase(); counts.set(email, (counts.get(email) ?? 0) + 1); }
  const repeat = [...counts.values()].filter((count) => count > 1).length;

  const physical = current.filter((order) => kindOf(order) === "physical");
  const shipHours = physical.filter((order) => order.shipped_at).map((order) => (new Date(order.shipped_at!).getTime() - at(order)) / 3_600_000).filter((hours) => hours >= 0).sort((a, b) => a - b);
  const median = shipHours.length ? (shipHours.length % 2 ? shipHours[(shipHours.length - 1) / 2] : (shipHours[shipHours.length / 2 - 1] + shipHours[shipHours.length / 2]) / 2) : null;

  const regionMap = new Map<string, { name: string; orders: number; revenue: number }>();
  for (const order of physical) {
    const address = order.shipping_address;
    if (!address) continue;
    const name = address.country === "US" || !address.country ? (address.state || "Unknown") : address.country;
    const entry = regionMap.get(name) ?? { name, orders: 0, revenue: 0 };
    entry.orders += 1; entry.revenue += order.amount_total ?? 0;
    regionMap.set(name, entry);
  }

  return {
    currency, otherCurrencies: ranked.slice(1), granularity, trend, kpis, products,
    split: { digital: gross(current.filter((order) => kindOf(order) === "digital")), physical: gross(physical) },
    weekdays, funnel,
    customers: { unique: counts.size, repeat, repeatRate: counts.size ? repeat / counts.size : null },
    fulfilment: { physicalOrders: physical.length, shipped: physical.filter((order) => order.shipped_at || order.fulfillment_status === "shipped" || order.fulfillment_status === "delivered").length, cancelled: physical.filter((order) => order.cancelled_at || order.fulfillment_status === "cancelled").length, medianHoursToShip: median },
    regions: [...regionMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
    refunds: { amount: refunded(current), orders: current.filter((order) => (order.refunded_amount ?? 0) > 0).length },
  };
}
