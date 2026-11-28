import "server-only";
import { getSupabase } from "./supabase";
import { STORE_ID } from "./store-config";
import { computeAnalytics, periods, type AnalyticsCheckout, type AnalyticsOrder, type Filters } from "./analytics";

const PAGE = 1000;
/** A hard ceiling so a very busy store can't turn one page view into an unbounded read. */
const MAX_ROWS = 20_000;
const ORDER_COLUMNS = "id, product_id, email, amount_total, currency, created_at, kind, product_snapshot, physical_snapshot, shipping_address, fulfillment_status, shipped_at, cancelled_at, refunded_amount";
const CHECKOUT_COLUMNS = "id, product_id, created_at, kind, expired_at, recovered_at, stripe_session_id";

async function readAll<T>(table: "orders" | "checkouts", columns: string, from: number, to: number, storeId: string) {
  const rows: T[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await getSupabase().from(table).select(columns).eq("store_id", storeId)
      .gte("created_at", new Date(from).toISOString()).lt("created_at", new Date(to).toISOString())
      .order("created_at", { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Could not load ${table} for analytics`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, truncated: rows.length >= MAX_ROWS };
}

/** Orders for the period and the one before it (for comparisons), and the period's checkout attempts. */
export async function loadAnalytics(filters: Filters, storeId = STORE_ID) {
  const { start, end, prevStart } = periods(filters);
  const [orders, checkouts] = await Promise.all([
    readAll<AnalyticsOrder>("orders", ORDER_COLUMNS, prevStart, end, storeId),
    readAll<AnalyticsCheckout>("checkouts", CHECKOUT_COLUMNS, start, end, storeId),
  ]);
  return { ...computeAnalytics(orders.rows, checkouts.rows, filters), truncated: orders.truncated || checkouts.truncated };
}
