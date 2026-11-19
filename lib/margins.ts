import "server-only";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { cardFee } from "./research.types";
import { cjConfigured, cjPidFromUrl, cjVariantPrices } from "./cj";
import { variantLabel } from "./storefront";
import type { CatalogProduct, ProductVariant } from "./catalog.types";
import type { Order } from "./database.types";

// Margin watch for physical products, without any supplier API that costs money:
//  - each variant records what one unit costs and what the supplier charges to ship it (manual);
//  - when an order is marked as ordered, what the owner really paid becomes the variant's cost;
//  - CJ products are re-priced daily from CJ's free API; every other supplier (AliExpress and the
//    like) gets a "check due" reminder once a week, since their prices can't be read automatically.
// Margin here is after supplier cost, supplier shipping and estimated card fees, before ad spend.

export const MARGIN_TARGET = 0.3;
/** A supplier price this much above the recorded cost raises an alert. */
export const PRICE_RISE = 0.05;
/** Suppliers without an API are due a manual check after this many days. */
export const CHECK_EVERY_DAYS = 7;
const DAY = 86400_000;

export type CostVariant = ProductVariant;
export type Supplier = "cj" | "aliexpress" | "alibaba" | "other" | null;
export type MarginRow = {
  variantId: string; productId: string; productName: string; productSlug: string; live: boolean; label: string;
  price: number; currency: string; unitCost: number | null; supplierShipping: number | null; margin: number | null; profit: number | null;
  costSource: CostVariant["cost_source"] | null; costUpdatedAt: string | null;
  supplierUrl: string | null; supplier: Supplier; checkedAt: string | null; checkDue: boolean; alert: string | null;
};

export function supplierOf(url: string | null): Supplier {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)cjdropshipping\.com$/.test(host)) return "cj";
    if (/(^|\.)aliexpress\.(com|us|ru)$|(^|\.)aliexpress\.[a-z.]+$/.test(host)) return "aliexpress";
    if (/(^|\.)(alibaba|1688)\.com$/.test(host)) return "alibaba";
    return "other";
  } catch { return "other"; }
}

/** Profit and margin on one unit: price minus supplier cost, supplier shipping and card fees. */
export function unitMargin(price: number, unitCost: number | null | undefined, supplierShipping: number | null | undefined) {
  if (unitCost === null || unitCost === undefined || price <= 0) return { profit: null, margin: null };
  const profit = price - unitCost - (supplierShipping ?? 0) - cardFee(price);
  return { profit, margin: profit / price };
}

export function checkDue(variant: Pick<CostVariant, "supplier_url" | "supplier_checked_at">, now = Date.now()) {
  const supplier = supplierOf(variant.supplier_url);
  if (!supplier || supplier === "cj") return false;
  return !variant.supplier_checked_at || now - Date.parse(variant.supplier_checked_at) >= CHECK_EVERY_DAYS * DAY;
}

export async function listMarginRows(now = Date.now()): Promise<MarginRow[]> {
  const db = getSupabase();
  const { data: products, error } = await db.from("products").select("*").eq("store_id", STORE_ID).eq("kind", "physical").order("sort_order");
  if (error) throw new HttpError(503, "Margins are temporarily unavailable.");
  const list = (products ?? []) as CatalogProduct[];
  if (!list.length) return [];
  const { data: variants, error: variantError } = await db.from("product_variants").select("*").eq("store_id", STORE_ID).in("product_id", list.map((product) => product.id)).order("position");
  if (variantError) throw new HttpError(503, "Margins are temporarily unavailable.");
  const byProduct = new Map(list.map((product) => [product.id, product]));
  return ((variants ?? []) as CostVariant[]).filter((variant) => variant.active).flatMap((variant) => {
    const product = byProduct.get(variant.product_id);
    if (!product) return [];
    const { profit, margin } = unitMargin(variant.price_amount, variant.unit_cost, variant.supplier_shipping);
    return [{
      variantId: variant.id, productId: product.id, productName: product.name, productSlug: product.slug, live: product.status === "published",
      label: variantLabel(variant.options ?? {}) || "Default", price: variant.price_amount, currency: product.currency,
      unitCost: variant.unit_cost ?? null, supplierShipping: variant.supplier_shipping ?? null, margin, profit,
      costSource: variant.cost_source ?? null, costUpdatedAt: variant.cost_updated_at ?? null,
      supplierUrl: variant.supplier_url, supplier: supplierOf(variant.supplier_url), checkedAt: variant.supplier_checked_at ?? null,
      checkDue: checkDue(variant, now), alert: variant.supplier_alert ?? null,
    }];
  });
}

export type MarginSummary = { belowTarget: number; missingCost: number; checksDue: number; alerts: number };
export function summarize(rows: MarginRow[]): MarginSummary {
  return {
    belowTarget: rows.filter((row) => row.margin !== null && row.margin < MARGIN_TARGET).length,
    missingCost: rows.filter((row) => row.unitCost === null).length,
    checksDue: rows.filter((row) => row.checkDue).length,
    alerts: rows.filter((row) => row.alert).length,
  };
}

const money = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000) throw new HttpError(400, `${label} must be an amount from 0.`);
  return Math.round(amount * 100);
};

async function ownVariant(id: unknown) {
  if (typeof id !== "string") throw new HttpError(400, "Choose a variant.");
  const { data, error } = await getSupabase().from("product_variants").select("*").eq("store_id", STORE_ID).eq("id", id).maybeSingle();
  if (error) throw new HttpError(503, "Margins are temporarily unavailable.");
  if (!data) throw new HttpError(404, "That variant no longer exists.");
  return data as CostVariant;
}

/** The owner types in what a unit costs and what the supplier charges to ship it. */
export async function saveVariantCost(body: Record<string, unknown>) {
  const variant = await ownVariant(body.variantId);
  const now = new Date().toISOString();
  const changes = { unit_cost: money(body.unitCost, "Unit cost"), supplier_shipping: money(body.supplierShipping, "Supplier shipping"), cost_source: "manual" as const, cost_updated_at: now, supplier_checked_at: now, supplier_alert: null };
  const { error } = await getSupabase().from("product_variants").update(changes).eq("id", variant.id).eq("store_id", STORE_ID);
  if (error) throw new HttpError(500, "Could not save the cost.");
  return { ok: true };
}

/** "I checked the supplier and the price is unchanged." */
export async function markChecked(body: Record<string, unknown>) {
  const variant = await ownVariant(body.variantId);
  const { error } = await getSupabase().from("product_variants").update({ supplier_checked_at: new Date().toISOString(), supplier_alert: null }).eq("id", variant.id).eq("store_id", STORE_ID);
  if (error) throw new HttpError(500, "Could not save the check.");
  return { ok: true };
}

/**
 * What the owner paid the supplier for an order becomes the variants' recorded cost: the real price is
 * the best signal there is. Orders with several variant lines split the cost by each line's share of
 * the order, so a mixed order still updates every variant it contains.
 */
export async function learnFromOrder(order: Order, supplierCost: number) {
  const items = order.physical_snapshot?.items ?? [];
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.unitAmount * item.quantity, 0);
  if (!items.length || !units || !subtotal) return;
  const db = getSupabase();
  const now = new Date().toISOString();
  for (const item of items) {
    const share = (item.unitAmount * item.quantity) / subtotal;
    const perUnit = Math.round((supplierCost * share) / item.quantity);
    const { data } = await db.from("product_variants").select("*").eq("store_id", order.store_id).eq("id", item.variantId).maybeSingle();
    const variant = data as CostVariant | null;
    if (!variant) continue;
    // The supplier's shipping is part of what was paid, so the product cost is what's left after it.
    const unitCost = Math.max(0, perUnit - (variant.supplier_shipping ?? 0));
    const { margin } = unitMargin(variant.price_amount, unitCost, variant.supplier_shipping);
    const rose = variant.unit_cost !== null && variant.unit_cost !== undefined && unitCost > variant.unit_cost * (1 + PRICE_RISE);
    const alert = rose ? `Last order cost ${(perUnit / 100).toFixed(2)} a unit, up from ${(((variant.unit_cost ?? 0) + (variant.supplier_shipping ?? 0)) / 100).toFixed(2)}.`
      : margin !== null && margin < MARGIN_TARGET ? `Margin is ${Math.round(margin * 100)}% at the last order's cost.` : null;
    await db.from("product_variants").update({ unit_cost: unitCost, cost_source: "order" as const, cost_updated_at: now, supplier_checked_at: now, supplier_alert: alert }).eq("id", variant.id);
  }
}

/** The daily CJ check: re-price CJ variants and flag any that got dearer or disappeared. */
export async function checkCjPrices(limit = 25) {
  if (!cjConfigured()) return { checked: 0, alerts: 0, skipped: "CJ_API_KEY not set" };
  const db = getSupabase();
  const { data, error } = await db.from("product_variants").select("*").eq("store_id", STORE_ID).eq("active", true);
  if (error) throw new Error("Could not load variants");
  const cjVariants = ((data ?? []) as CostVariant[]).filter((variant) => cjPidFromUrl(variant.supplier_url));
  const byPid = new Map<string, CostVariant[]>();
  for (const variant of cjVariants) {
    const pid = cjPidFromUrl(variant.supplier_url)!;
    byPid.set(pid, [...(byPid.get(pid) ?? []), variant]);
  }
  let checked = 0; let alerts = 0;
  const now = new Date().toISOString();
  for (const [pid, variants] of [...byPid].slice(0, limit)) {
    const prices = await cjVariantPrices(pid).catch(() => undefined);
    if (prices === undefined) continue;
    for (const variant of variants) {
      let alert: string | null = null; let seen: number | null = null;
      if (prices === null || !prices.length) alert = "CJ no longer lists this product.";
      else {
        const match = prices.find((price) => price.vid === variant.supplier_sku || (price.sku && price.sku === variant.supplier_sku));
        seen = (match ?? [...prices].sort((a, b) => a.cost - b.cost)[0]).cost;
        if (variant.unit_cost !== null && variant.unit_cost !== undefined && seen > variant.unit_cost * (1 + PRICE_RISE)) {
          alert = `CJ now charges ${(seen / 100).toFixed(2)}, up from ${(variant.unit_cost / 100).toFixed(2)}.`;
        }
      }
      const changes: Partial<CostVariant> = { supplier_checked_at: now, supplier_price_seen: seen, supplier_alert: alert };
      // A variant with no recorded cost yet starts from CJ's price.
      if ((variant.unit_cost === null || variant.unit_cost === undefined) && seen !== null) Object.assign(changes, { unit_cost: seen, cost_source: "cj" as const, cost_updated_at: now });
      await db.from("product_variants").update(changes).eq("id", variant.id);
      checked += 1; if (alert) alerts += 1;
    }
  }
  return { checked, alerts };
}
