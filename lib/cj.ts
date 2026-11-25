import "server-only";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import type { CjDetail, CjProduct } from "./research.types";

// CJ Dropshipping API 2.0 (developers.cjdropshipping.com), for supplier costs on the research board.
// Needs CJ_API_KEY. CJ hands out an access token for the key and limits how often it may be asked for,
// so the token is kept in integration_tokens and shared by every server instance until it nears expiry.
// All CJ prices are USD; the board stores them in cents.

const API = "https://developers.cjdropshipping.com/api2.0/v1";
/** Ask for a fresh token this long before the current one expires. */
const REFRESH_MARGIN = 3 * 86400_000;

type Envelope<T> = { code?: number; result?: boolean; success?: boolean; message?: string; data?: T };

export const cjConfigured = () => !!process.env.CJ_API_KEY?.trim();

/** "12.5", 12.5 or a range like "3.20-4.10" (the lowest variant price) to cents. */
export function toCents(value: unknown): number | null {
  const first = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.split(/\s*-{1,2}\s*/)[0]) : NaN;
  return Number.isFinite(first) && first >= 0 ? Math.round(first * 100) : null;
}

async function requestToken(apiKey: string) {
  const response = await fetch(`${API}/authentication/getAccessToken`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({})) as Envelope<{ accessToken?: string; accessTokenExpiryDate?: string }>;
  const token = body.data?.accessToken;
  if (!response.ok || !body.result || !token) throw new HttpError(502, "CJ didn't accept the API key. Check CJ_API_KEY in this environment.");
  const expiry = Date.parse(body.data?.accessTokenExpiryDate ?? "");
  // CJ's tokens last 180 days; assume 14 if it doesn't say, so a bad date never pins a dead token.
  return { token, expiresAt: new Date(Number.isNaN(expiry) ? Date.now() + 14 * 86400_000 : expiry).toISOString() };
}

async function accessToken(forceNew = false) {
  const apiKey = process.env.CJ_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, "Add CJ_API_KEY to this environment to search CJ from here.");
  const supabase = getSupabase();
  if (!forceNew) {
    const { data } = await supabase.from("integration_tokens").select("access_token, expires_at").eq("provider", "cj").maybeSingle();
    const saved = data as { access_token: string; expires_at: string } | null;
    if (saved && Date.parse(saved.expires_at) - Date.now() > REFRESH_MARGIN) return saved.access_token;
  }
  const fresh = await requestToken(apiKey);
  await supabase.from("integration_tokens").upsert({ provider: "cj", access_token: fresh.token, expires_at: fresh.expiresAt, updated_at: new Date().toISOString() });
  return fresh.token;
}

// CJ allows 1 request a second on the free level (more on paid levels) and answers 429 / 1600200 past it.
// Calls from one server instance are spaced out, and a rate-limited call waits once and tries again.
const SPACING = process.env.NODE_ENV === "test" ? 0 : 1100;
const RATE_WAIT = process.env.NODE_ENV === "test" ? 0 : 2000;
let nextSlot = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function takeSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + SPACING;
  if (wait) await sleep(wait);
}

async function cj<T>(path: string, init: RequestInit = {}, retried = false, rateRetried = false): Promise<T> {
  const token = await accessToken(retried);
  await takeSlot();
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init, headers: { "Content-Type": "application/json", "CJ-Access-Token": token, ...init.headers },
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // 504, not 502: the daily check reads 502 as "CJ answered and no longer lists this product".
    throw new HttpError(504, "Couldn't reach CJ. Try again in a moment.");
  }
  const body = await response.json().catch(() => ({})) as Envelope<T>;
  // 1600001: the token was rejected (expired or replaced). Get a new one once and retry.
  if ((response.status === 401 || body.code === 1600001) && !retried) return cj(path, init, true, rateRetried);
  if (response.status === 429 || body.code === 1600200) {
    if (!rateRetried) { await sleep(RATE_WAIT); return cj(path, init, retried, true); }
    throw new HttpError(429, "CJ is limiting requests right now. Wait a few seconds and try again.");
  }
  if (response.status >= 500) throw new HttpError(504, "CJ is having trouble right now. Try again in a moment.");
  if (!response.ok || body.result === false || body.data === undefined) throw new HttpError(502, body.message ? `CJ: ${body.message.slice(0, 160)}` : "CJ couldn't answer that request.");
  return body.data;
}

/** CJ's product page address: the name as a slug, then the product id. */
export function cjProductUrl(name: string, pid: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "product";
  return `https://cjdropshipping.com/product/${slug}-p-${encodeURIComponent(pid)}.html`;
}

type ListV2 = { content?: { productList?: {
  id?: string; nameEn?: string; bigImage?: string; sellPrice?: string | number; categoryName?: string; threeCategoryName?: string; listedNum?: number;
  warehouseInventoryNum?: number | string; deliveryCycle?: number | string;
}[] }[] };

const count = (value: unknown) => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
};

/** `usStock`: only products CJ holds in its US warehouses (listV2's countryCode filter), which arrive in days, not weeks. */
export async function searchCj(keyword: string, usStock = false): Promise<CjProduct[]> {
  const params = new URLSearchParams({ keyWord: keyword, page: "1", size: "24", ...(usStock ? { countryCode: "US" } : {}) });
  const data = await cj<ListV2>(`/product/listV2?${params}`);
  return (data.content ?? []).flatMap((group) => group.productList ?? [])
    .filter((product) => product.id && product.nameEn)
    .map((product) => ({
      id: product.id!, name: product.nameEn!.slice(0, 200),
      image: product.bigImage?.startsWith("https://") ? product.bigImage : null,
      cost: toCents(product.sellPrice), category: product.threeCategoryName ?? product.categoryName ?? null,
      listed: typeof product.listedNum === "number" ? product.listedNum : null, url: cjProductUrl(product.nameEn!, product.id!),
      stock: count(product.warehouseInventoryNum), deliveryDays: count(product.deliveryCycle), usStock,
    }));
}

type Inventory = { countryCode?: string; totalInventory?: number | string };
type DetailVariant = { vid?: string; variantSku?: string; variantSellPrice?: number | string; inventories?: Inventory[] };

/** A variant's stock across CJ's warehouses, and in the US. Null when CJ didn't say (never read as sold out). */
export function variantStock(inventories: Inventory[] | undefined) {
  if (!Array.isArray(inventories)) return { total: null, us: null };
  let total = 0; let us = 0;
  for (const inventory of inventories) {
    const amount = count(inventory.totalInventory) ?? 0;
    total += amount;
    if (inventory.countryCode?.toUpperCase() === "US") us += amount;
  }
  return { total, us };
}

type Detail = { pid?: string; productNameEn?: string; bigImage?: string; sellPrice?: number | string; variants?: DetailVariant[] };
type Freight = { logisticName?: string; logisticPrice?: number | string; logisticAging?: string }[];
type Quote = { cost: number; name: string | null; days: string | null };

/** The cheapest way CJ can ship one unit of a variant from `from` to the US, or null when it can't quote. */
async function cheapestQuote(vid: string, from: "US" | "CN"): Promise<Quote | null> {
  // A quote is a bonus: the product is still worth saving when CJ can't quote shipping for it.
  const quotes = await cj<Freight>("/logistic/freightCalculate", {
    method: "POST", body: JSON.stringify({ startCountryCode: from, endCountryCode: "US", products: [{ quantity: 1, vid }] }),
  }).catch(() => [] as Freight);
  return (Array.isArray(quotes) ? quotes : [])
    .map((quote) => ({ cost: toCents(quote.logisticPrice), name: quote.logisticName?.slice(0, 80) ?? null, days: quote.logisticAging ? `${quote.logisticAging.slice(0, 30)} days` : null }))
    .filter((quote): quote is Quote => quote.cost !== null)
    .sort((a, b) => a.cost - b.cost)[0] ?? null;
}

/**
 * A product's lowest variant cost and the cheapest CJ shipping for it to the US. When CJ holds that
 * variant in a US warehouse, shipping is quoted from there (days, not weeks), falling back to China.
 */
export async function cjDetail(pid: string): Promise<CjDetail> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(pid)) throw new HttpError(400, "That CJ product id isn't valid.");
  const product = await cj<Detail>(`/product/query?${new URLSearchParams({ pid })}`);
  const variants = (product.variants ?? []).filter((variant) => variant.vid);
  const priced = variants.map((variant) => ({ vid: variant.vid!, cost: toCents(variant.variantSellPrice), stock: variantStock(variant.inventories) }))
    .filter((variant) => variant.cost !== null);
  const cheapest = priced.sort((a, b) => a.cost! - b.cost!)[0];
  const cost = cheapest?.cost ?? toCents(product.sellPrice);
  if (cost === null) throw new HttpError(502, "CJ didn't return a price for that product.");

  let shipping: Quote | null = null;
  let shipsFrom: CjDetail["shipsFrom"] = null;
  if (cheapest) {
    if ((cheapest.stock.us ?? 0) > 0) { shipping = await cheapestQuote(cheapest.vid, "US"); if (shipping) shipsFrom = "US"; }
    if (!shipping) { shipping = await cheapestQuote(cheapest.vid, "CN"); if (shipping) shipsFrom = "CN"; }
  }
  const stocks = variants.map((variant) => variantStock(variant.inventories));
  const known = stocks.some((stock) => stock.total !== null);
  const name = (product.productNameEn ?? "CJ product").slice(0, 200);
  return {
    source: "cj", id: pid, name, url: cjProductUrl(name, pid),
    cost, shipping: shipping?.cost ?? null,
    shippingName: shipping?.name ? (shipsFrom === "US" ? `${shipping.name} (US warehouse)` : shipping.name).slice(0, 80) : null, days: shipping?.days ?? null,
    image: product.bigImage?.startsWith("https://") ? product.bigImage : null, variants: variants.length,
    shipsFrom, stock: known ? stocks.reduce((sum, stock) => sum + (stock.total ?? 0), 0) : null,
    usStock: known ? stocks.reduce((sum, stock) => sum + (stock.us ?? 0), 0) : null,
  };
}

/** CJ's product id from a product page address (…-p-<pid>.html), or null for other links. */
export function cjPidFromUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)cjdropshipping\.com$/.test(parsed.hostname)) return null;
    return decodeURIComponent(parsed.pathname).match(/-p-([A-Za-z0-9-]{1,64})\.html$/)?.[1] ?? null;
  } catch { return null; }
}

export type CjVariantPrice = { vid: string; sku: string | null; cost: number; stock?: number | null };

/**
 * Every variant's current CJ price and stock, for the daily margin check (lib/margins.ts). Null when CJ
 * answers that it no longer lists the product; a network failure throws instead, so it's never read as that.
 */
export async function cjVariantPrices(pid: string): Promise<CjVariantPrice[] | null> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(pid)) return null;
  const product = await cj<Detail>(`/product/query?${new URLSearchParams({ pid })}`).catch((error) => {
    if (error instanceof HttpError && error.status === 502) return null;
    throw error;
  });
  if (!product) return null;
  const variants = (product.variants ?? [])
    .map((variant) => ({ vid: variant.vid ?? "", sku: variant.variantSku ?? null, cost: toCents(variant.variantSellPrice), stock: variantStock(variant.inventories).total }))
    .filter((variant): variant is { vid: string; sku: string | null; cost: number; stock: number | null } => !!variant.vid && variant.cost !== null);
  if (variants.length) return variants;
  const cost = toCents(product.sellPrice);
  return cost === null ? [] : [{ vid: pid, sku: null, cost, stock: null }];
}
