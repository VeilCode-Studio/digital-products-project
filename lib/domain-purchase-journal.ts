import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { normalizeDomain } from "./domain-rules";
import { DOMAIN_REQUEST_ID } from "./domain-checkout";
import type { DomainPurchase } from "./domain-purchase.types";
import { DOMAIN_TERMS_VERSION } from "./domain-registration-terms";

export const DOMAIN_PURCHASE_APP = "veilcode-domain-purchase";
export type DomainPurchaseContext = { storeId: string; ownerId: string; origin: string; livemode: boolean };
type ReviewedPurchase = { id: string; productId: string; hostname: string; amount: number; renewalAmount: number; years: number; autoRenew: boolean; contact: Record<string, unknown>; simulationScenario?: "success" | "failure" | "uncertain" | null };

function journalError() { return new HttpError(503, "The domain purchase record could not be saved. Check its status before trying again."); }
const purchases = () => getSupabase().from("domain_purchases");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

/** All owner-facing reads must use this filter, including requests returning from Checkout. */
export async function ownedDomainPurchase(id: string, context: DomainPurchaseContext): Promise<DomainPurchase | null> {
  if (!DOMAIN_REQUEST_ID.test(id)) throw new HttpError(400, "Invalid domain purchase.");
  const { data, error } = await purchases().select("*").eq("id", id).eq("store_id", context.storeId)
    .eq("owner_user_id", context.ownerId).eq("origin", context.origin).eq("livemode", context.livemode).maybeSingle();
  if (error) throw journalError();
  return data;
}

/** The caller supplies a freshly rechecked server quote and validated registrar contact, never raw browser prices. */
export async function saveReviewedDomainPurchase(review: ReviewedPurchase, context: DomainPurchaseContext) {
  if (!DOMAIN_REQUEST_ID.test(review.id) || normalizeDomain(review.hostname) !== review.hostname ||
      !Number.isInteger(review.amount) || review.amount < 50 || review.amount > 10_000_000 ||
      !Number.isInteger(review.renewalAmount) || review.renewalAmount <= 0 ||
      !Number.isInteger(review.years) || review.years < 1 || review.years > 10) throw new HttpError(400, "Review a current domain quote before purchasing.");
  // Explicit context makes this usable for independently owned stores without a legacy-store fallback.
  const { data: store, error: storeError } = await getSupabase().from("stores").select("id").eq("id", context.storeId).eq("owner_user_id", context.ownerId).maybeSingle();
  if (storeError) throw journalError();
  if (!store) throw new HttpError(403, "You cannot purchase a domain for this store.");
  const { data: product, error: productError } = await getSupabase().from("products").select("id").eq("store_id", context.storeId).eq("id", review.productId).maybeSingle();
  if (productError) throw journalError();
  if (!product) throw new HttpError(404, "Choose a product belonging to this store.");
  const requestHash = createHash("sha256").update(JSON.stringify(canonical({ context, review, termsVersion: DOMAIN_TERMS_VERSION }))).digest("hex");
  const existing = await ownedDomainPurchase(review.id, context);
  if (existing) {
    if (existing.request_hash !== requestHash) throw new HttpError(409, "This purchase request changed. Start a new review.");
    return existing;
  }
  const { data, error } = await purchases().insert({
    id: review.id, store_id: context.storeId, owner_user_id: context.ownerId, product_id: review.productId,
    hostname: review.hostname, origin: context.origin, livemode: context.livemode,
    amount: review.amount, renewal_amount: review.renewalAmount, currency: "usd", years: review.years, auto_renew: review.autoRenew,
    request_hash: requestHash, contact: review.contact, status: "checkout_pending", simulation_scenario: context.livemode ? null : review.simulationScenario ?? "success", terms_version: DOMAIN_TERMS_VERSION,
  }).select("*").single();
  if (error?.code === "23505") {
    const concurrent = await ownedDomainPurchase(review.id, context);
    if (concurrent?.request_hash === requestHash) return concurrent;
    throw new HttpError(409, "A purchase for this domain is already pending. Check your previous purchase before starting another.");
  }
  if (error || !data) throw journalError();
  return data;
}

/** Signed webhooks still need to match the frozen purchase. A browser success flag cannot call this. */
function sessionIdentity(purchase: DomainPurchase, session: Stripe.Checkout.Session) {
  return session.livemode === purchase.livemode && session.mode === "payment" &&
    session.id.startsWith(purchase.livemode ? "cs_live_" : "cs_test_") && session.currency === purchase.currency && session.amount_total === purchase.amount &&
    session.amount_subtotal === purchase.amount &&
    session.client_reference_id === purchase.id && session.metadata?.app === DOMAIN_PURCHASE_APP &&
    session.metadata.purchase_id === purchase.id && session.metadata.store_id === purchase.store_id &&
    session.metadata.owner_id === purchase.owner_user_id && session.metadata.origin === purchase.origin &&
    session.metadata.domain === purchase.hostname;
}

export function domainPurchaseMatchesSession(purchase: DomainPurchase, session: Stripe.Checkout.Session) {
  return sessionIdentity(purchase, session) && session.payment_status === "paid" && session.status === "complete" && session.id === purchase.stripe_session_id;
}

/** Bind Stripe's idempotent session response exactly once; recovery never attaches a new charge to an old review. */
export async function bindDomainCheckout(purchase: DomainPurchase, session: Stripe.Checkout.Session) {
  if (!sessionIdentity(purchase, session)) throw new HttpError(409, "The checkout does not match the reviewed domain purchase.");
  const { data, error } = await purchases().update({ stripe_session_id: session.id }).eq("id", purchase.id)
    .eq("status", "checkout_pending").is("stripe_session_id", null).select("*").maybeSingle();
  if (error) throw journalError();
  if (data) return data;
  const current = await ownedDomainPurchase(purchase.id, { ownerId: purchase.owner_user_id, storeId: purchase.store_id, origin: purchase.origin, livemode: purchase.livemode });
  if (current?.stripe_session_id === session.id) return current;
  throw new HttpError(409, "A different checkout is already attached to this purchase. Check its status before trying again.");
}

export async function recordDomainPayment(purchase: DomainPurchase, session: Stripe.Checkout.Session) {
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!domainPurchaseMatchesSession(purchase, session) || !intentId?.startsWith("pi_")) throw new HttpError(409, "The payment does not match this domain purchase.");
  if (purchase.status !== "checkout_pending") {
    if (purchase.stripe_payment_intent_id !== intentId) throw new HttpError(409, "The payment reference does not match this purchase.");
    return;
  }
  const { data, error } = await purchases().update({ status: "paid", stripe_payment_intent_id: intentId })
    .eq("id", purchase.id).eq("status", "checkout_pending").eq("stripe_session_id", session.id).select("*").maybeSingle();
  if (error) throw journalError();
  if (!data) {
    const current = await ownedDomainPurchase(purchase.id, { ownerId: purchase.owner_user_id, storeId: purchase.store_id, origin: purchase.origin, livemode: purchase.livemode });
    if (!current || current.stripe_payment_intent_id !== intentId) throw new HttpError(409, "The purchase changed before payment could be recorded. Payment reconciliation is required.");
  }
}

/** Atomic, non-expiring claim. Unknown registrar outcomes require reconciliation, never an automatic new buy. */
export async function claimDomainRegistration(id: string) {
  const { data, error } = await getSupabase().rpc("claim_domain_registration", { p_id: id });
  if (error) throw journalError();
  return data?.[0] ?? null;
}
