import "server-only";
import type Stripe from "stripe";
import { getSupabase } from "./supabase";
import { getStripe } from "./stripe";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { paymentContext, stripeOptions } from "./payment-connections";

// Discount codes shoppers type at Stripe Checkout (allow_promotion_codes is on for both checkouts).
// Stripe holds and enforces each code (a coupon plus a promotion code, in whichever account takes
// payments); the discount_codes table remembers them so paid orders can be credited to their code.
// Free to run: Stripe charges nothing extra for promotion codes.

export type DiscountCode = {
  id: string; store_id: string; code: string; percent_off: number | null; amount_off: number | null; currency: string | null;
  max_redemptions: number | null; expires_at: string | null; active: boolean; label: string | null;
  stripe_coupon_id: string; stripe_promotion_code_id: string; stripe_account_id: string | null; livemode: boolean;
  created_at: string; updated_at: string;
};
export type CodeStats = { orders: number; revenue: number; discounted: number; currency: string | null };
export type DiscountCodeRow = DiscountCode & { stats: CodeStats; usable: boolean };

export const CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

/** "tiktok 10" → "TIKTOK10". Shoppers type codes in any case; Stripe matches them case-insensitively. */
export function normalizeCode(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase().replace(/[\s_]+/g, "").replace(/[^A-Z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "") : "";
}
export function codeProblem(code: string) {
  if (code.length < 3) return "Use at least 3 letters or numbers.";
  if (code.length > 24) return "Keep it to 24 characters or fewer.";
  if (!CODE_PATTERN.test(code)) return "Use letters, numbers and single hyphens.";
  return null;
}

/** Whether Stripe would still accept the code (active, not expired, uses left). */
export function codeUsable(code: Pick<DiscountCode, "active" | "expires_at" | "max_redemptions">, orders: number, now = Date.now()) {
  return code.active && (!code.expires_at || Date.parse(code.expires_at) > now) && (code.max_redemptions === null || orders < code.max_redemptions);
}

export function describeDiscount(code: Pick<DiscountCode, "percent_off" | "amount_off" | "currency">) {
  if (code.percent_off) return `${code.percent_off}% off`;
  const amount = (code.amount_off ?? 0) / 100;
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency: (code.currency ?? "usd").toUpperCase(), maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount)} off`;
}

export async function listDiscountCodes(): Promise<DiscountCodeRow[]> {
  const db = getSupabase();
  const { data, error } = await db.from("discount_codes").select("*").eq("store_id", STORE_ID).order("created_at", { ascending: false });
  if (error) throw new HttpError(503, "Discount codes are temporarily unavailable.");
  const codes = (data ?? []) as DiscountCode[];
  const stats = new Map<string, CodeStats>();
  if (codes.length) {
    const { data: orders, error: orderError } = await db.from("orders").select("discount_code, amount_total, discount_amount, currency, refunded_amount")
      .eq("store_id", STORE_ID).in("discount_code", codes.map((code) => code.code));
    if (orderError) throw new HttpError(503, "Discount codes are temporarily unavailable.");
    for (const order of (orders ?? []) as { discount_code: string; amount_total: number | null; discount_amount: number | null; currency: string | null; refunded_amount: number | null }[]) {
      const entry = stats.get(order.discount_code) ?? { orders: 0, revenue: 0, discounted: 0, currency: order.currency };
      entry.orders += 1;
      entry.revenue += Math.max(0, (order.amount_total ?? 0) - (order.refunded_amount ?? 0));
      entry.discounted += order.discount_amount ?? 0;
      stats.set(order.discount_code, entry);
    }
  }
  return codes.map((code) => {
    const entry = stats.get(code.code) ?? { orders: 0, revenue: 0, discounted: 0, currency: null };
    return { ...code, stats: entry, usable: codeUsable(code, entry.orders) };
  });
}

type CreateInput = Record<string, unknown>;

export async function createDiscountCode(body: CreateInput): Promise<DiscountCodeRow> {
  const code = normalizeCode(body.code);
  const problem = codeProblem(code);
  if (problem) throw new HttpError(400, problem);
  const kind = body.kind === "amount" ? "amount" : "percent";
  const value = Number(body.value);
  let percentOff: number | null = null; let amountOff: number | null = null; let currency: string | null = null;
  if (kind === "percent") {
    if (!Number.isInteger(value) || value < 1 || value > 90) throw new HttpError(400, "Choose a percentage from 1 to 90.");
    percentOff = value;
  } else {
    if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new HttpError(400, "Choose an amount between 0.01 and 1,000.");
    amountOff = Math.round(value * 100);
    currency = body.currency === "gbp" ? "gbp" : "usd";
  }
  const maxRedemptions = body.maxRedemptions === null || body.maxRedemptions === undefined || body.maxRedemptions === "" ? null : Number(body.maxRedemptions);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100_000)) throw new HttpError(400, "Uses must be a whole number from 1.");
  let expiresAt: Date | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt) {
    // A date means "until the end of that day" (UTC), so a code labelled for the 30th works all day on the 30th.
    expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt) ? new Date(`${body.expiresAt}T23:59:59Z`) : new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick an end date in the future.");
  }
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;

  const db = getSupabase();
  const { data: taken } = await db.from("discount_codes").select("id").eq("store_id", STORE_ID).eq("code", code).maybeSingle();
  if (taken) throw new HttpError(409, `${code} already exists. Pick another code.`);

  const context = await paymentContext();
  const options = stripeOptions(context);
  const stripe = getStripe();
  const metadata = { app: "veilcode-store", store_id: STORE_ID, code };
  let coupon: Stripe.Coupon; let promotion: Stripe.PromotionCode;
  try {
    coupon = await stripe.coupons.create({
      duration: "once", name: code, metadata,
      ...(percentOff ? { percent_off: percentOff } : { amount_off: amountOff!, currency: currency! }),
    }, options);
    promotion = await stripe.promotionCodes.create({
      promotion: { type: "coupon", coupon: coupon.id }, code, metadata,
      ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
      ...(expiresAt ? { expires_at: Math.floor(expiresAt.getTime() / 1000) } : {}),
    }, options);
  } catch (error) {
    const message = (error as { code?: string; message?: string }).code === "resource_already_exists"
      ? `${code} already exists in Stripe. Pick another code.` : "Stripe couldn't create the code. Please try again.";
    throw new HttpError(502, message);
  }
  const { data, error } = await db.from("discount_codes").insert({
    store_id: STORE_ID, code, percent_off: percentOff, amount_off: amountOff, currency, max_redemptions: maxRedemptions,
    expires_at: expiresAt?.toISOString() ?? null, label, stripe_coupon_id: coupon.id, stripe_promotion_code_id: promotion.id,
    stripe_account_id: context.accountId, livemode: context.livemode,
  }).select("*").single();
  if (error || !data) {
    // Never leave a live code in Stripe that the store can't see or switch off.
    await stripe.promotionCodes.update(promotion.id, { active: false }, options).catch(() => {});
    throw new HttpError(500, "Could not save the code. Please try again.");
  }
  return { ...(data as DiscountCode), stats: { orders: 0, revenue: 0, discounted: 0, currency: null }, usable: true };
}

async function ownCode(id: unknown) {
  if (typeof id !== "string") throw new HttpError(400, "Choose a code.");
  const { data, error } = await getSupabase().from("discount_codes").select("*").eq("store_id", STORE_ID).eq("id", id).maybeSingle();
  if (error) throw new HttpError(503, "Discount codes are temporarily unavailable.");
  if (!data) throw new HttpError(404, "That code no longer exists.");
  return data as DiscountCode;
}

/** Pause or resume a code. Stripe is updated first, so the switch is real before the admin shows it. */
export async function setDiscountCodeActive(body: CreateInput): Promise<DiscountCode> {
  const code = await ownCode(body.id);
  const active = body.active === true;
  try {
    await getStripe().promotionCodes.update(code.stripe_promotion_code_id, { active }, code.stripe_account_id ? { stripeAccount: code.stripe_account_id } : {});
  } catch { throw new HttpError(502, "Stripe couldn't update the code. Please try again."); }
  const { data, error } = await getSupabase().from("discount_codes").update({ active, updated_at: new Date().toISOString() })
    .eq("id", code.id).eq("store_id", STORE_ID).select("*").single();
  if (error || !data) throw new HttpError(500, "Could not save the change.");
  return data as DiscountCode;
}

/** What a completed Checkout Session saved, and the store's code for it, for the order record. */
export async function discountFromSession(session: Pick<Stripe.Checkout.Session, "discounts" | "total_details">) {
  const amount = session.total_details?.amount_discount ?? 0;
  const promotion = session.discounts?.find((entry) => entry.promotion_code)?.promotion_code;
  const promotionId = typeof promotion === "string" ? promotion : promotion?.id ?? null;
  if (!amount && !promotionId) return { discountCode: null, discountAmount: null };
  let code: string | null = null;
  if (promotionId) {
    const { data } = await getSupabase().from("discount_codes").select("code").eq("stripe_promotion_code_id", promotionId).maybeSingle();
    code = (data as { code: string } | null)?.code ?? (typeof promotion === "object" && promotion ? promotion.code : null);
  }
  return { discountCode: code, discountAmount: amount || null };
}
