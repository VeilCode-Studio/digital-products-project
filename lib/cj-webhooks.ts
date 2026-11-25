import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { getDeployment, getEnv } from "./env";
import { checkCjPrices } from "./margins";
import { syncCjOrders } from "./cj-orders";
import { cjConfigured, cjPidFromUrl, cjSetWebhooks, cjSubscribeProducts } from "./cj";
import type { ProductVariant } from "./catalog.types";

// CJ's notifications (order, tracking, stock and product changes), so orders ship and stock alerts
// land within minutes instead of at the next daily check.
//
// Nothing in a notification is trusted. It only says which orders or products to look at again, and
// the store then reads those from CJ's API with its own token, exactly as the daily check does. The
// callback address carries a key derived from CJ_API_KEY, so only CJ knows where to send them.

/** The secret part of the callback address. Changes if CJ_API_KEY changes (then reconnect). */
export function webhookKey() {
  const apiKey = process.env.CJ_API_KEY?.trim();
  if (!apiKey) return null;
  return createHmac("sha256", apiKey).update("veilcode-cj-webhook-v1").digest("base64url").slice(0, 32);
}

export function validWebhookKey(given: string | null) {
  const expected = webhookKey();
  if (!expected || !given) return false;
  const a = Buffer.from(given); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every string in a notification that could name an order or a product, up to a few levels deep. */
export function notificationIds(payload: unknown) {
  const ids = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || ids.size > 200) return;
    if (typeof value === "string" || typeof value === "number") {
      const text = String(value).trim();
      if (/^[A-Za-z0-9-]{4,64}$/.test(text)) ids.add(text);
    } else if (Array.isArray(value)) value.slice(0, 100).forEach((item) => walk(item, depth + 1));
    else if (value && typeof value === "object") Object.values(value).slice(0, 100).forEach((item) => walk(item, depth + 1));
  };
  walk(payload, 0);
  return [...ids];
}

/** Rechecks whatever a notification names: our CJ orders (tracking, delivery) and CJ products (price, stock). */
export async function handleCjNotification(payload: unknown) {
  const ids = notificationIds(payload);
  if (!ids.length || !cjConfigured()) return { orders: null, products: null };
  const wanted = new Set(ids);
  const { data } = await getSupabase().from("product_variants").select("*").eq("store_id", STORE_ID).eq("active", true);
  const pids = new Set<string>();
  for (const variant of (data ?? []) as ProductVariant[]) {
    const pid = cjPidFromUrl(variant.supplier_url);
    // Stock notifications name the variant (vid or SKU), product ones the product.
    if (pid && (wanted.has(pid) || (variant.supplier_sku && wanted.has(variant.supplier_sku)))) pids.add(pid);
  }
  const orders = await syncCjOrders(10, 20_000, ids);
  const products = pids.size ? await checkCjPrices(10, 20_000, [...pids]) : null;
  return { orders, products };
}

/** Every CJ product linked to an active variant. */
async function linkedPids() {
  const { data, error } = await getSupabase().from("product_variants").select("*").eq("store_id", STORE_ID).eq("active", true);
  if (error) throw new Error("Could not load variants");
  return [...new Set(((data ?? []) as ProductVariant[]).map((variant) => cjPidFromUrl(variant.supplier_url)).filter((pid): pid is string => !!pid))];
}

/**
 * Turns CJ's notifications on for this store (production only: CJ must reach the address, and staging
 * sits behind Vercel's login). CJ allows one address per account, so connecting again just repoints it.
 */
export async function connectCjUpdates() {
  if (!cjConfigured()) throw new HttpError(503, "Add CJ_API_KEY to this environment first.");
  if (!getDeployment().production) throw new HttpError(409, "Connect CJ updates from the live store. CJ can't reach staging, and it allows only one address per account.");
  await cjSetWebhooks(new URL(`/api/webhooks/cj/${webhookKey()}`, getEnv().APP_URL).toString());
  const subscribed = await cjSubscribeProducts(await linkedPids());
  return { connected: true, products: subscribed };
}

/** Product subscriptions expire after 30 days, so the daily job renews them (and adds new links). */
export async function renewCjSubscriptions() {
  if (!cjConfigured() || !getDeployment().production) return { skipped: true };
  try { return { products: await cjSubscribeProducts(await linkedPids()) }; } catch (error) {
    // 1606010: notifications aren't connected yet; nothing to renew until the owner connects them.
    if (error instanceof HttpError && /not enabled/i.test(error.message)) return { skipped: "not connected" };
    throw error;
  }
}
