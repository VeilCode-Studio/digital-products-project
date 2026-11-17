import "server-only";
import type Stripe from "stripe";
import { getSupabase } from "./supabase";
import { STORE_ID } from "./store-config";
import type { Checkout } from "./catalog.types";

// Abandoned checkout recovery. Stripe expires an unpaid Checkout Session after 24 hours; the webhook
// records it here with Stripe's recovery link, which reopens the same cart for 30 days. The shopper's
// email is kept only when they agreed on the checkout page to hear from the store (promotional
// consent), so following up never emails someone who didn't ask.

/** Recovery links stop working 30 days after the session expired. */
export const RECOVERY_DAYS = 30;

export type AbandonedCheckout = {
  id: string; product: string; productSlug: string; kind: "digital" | "physical"; amount: number; currency: string;
  quantity: number; expiredAt: string; email: string | null; recoveryUrl: string | null;
};

type CheckoutRow = Checkout;

/** Records an expired, unpaid session for the checkout it was made for. Anything else is ignored. */
export async function recordExpiredSession(session: Stripe.Checkout.Session, storeId = STORE_ID) {
  const checkoutId = session.metadata?.app === "veilcode-store" ? session.metadata.checkout_id : null;
  if (!checkoutId || session.payment_status === "paid") return false;
  const consented = session.consent?.promotions === "opt_in";
  const email = consented ? session.customer_details?.email?.trim().toLowerCase().slice(0, 254) || null : null;
  const recoveryUrl = session.after_expiration?.recovery?.url ?? null;
  const { data, error } = await getSupabase().from("checkouts")
    .update({ expired_at: new Date((session.expires_at ?? Date.now() / 1000) * 1000).toISOString(), recovery_url: recoveryUrl?.startsWith("https://") ? recoveryUrl : null, recovery_email: email })
    .eq("id", checkoutId).eq("store_id", storeId).eq("stripe_session_id", session.id).select("id").maybeSingle();
  if (error) throw new Error("Could not record the abandoned checkout");
  return !!data;
}

/**
 * A shopper who came back through a recovery link pays on a new session. That session belongs to the
 * same reservation, so it takes over the checkout (and marks it recovered) before the order is made.
 */
export async function adoptRecoveredSession(session: Stripe.Checkout.Session, storeId = STORE_ID): Promise<Checkout | null> {
  const original = typeof session.recovered_from === "string" ? session.recovered_from : null;
  if (!original) return null;
  const db = getSupabase();
  const bySession = async (id: string) => {
    const { data, error } = await db.from("checkouts").select("*").eq("store_id", storeId).eq("stripe_session_id", id).maybeSingle();
    if (error) throw new Error("Could not load the recovered checkout");
    return data as CheckoutRow | null;
  };
  // A retried webhook finds the checkout already adopted.
  const adopted = await bySession(session.id);
  if (adopted) return adopted;
  const checkout = await bySession(original);
  if (!checkout) return null;
  // The new session must be for exactly what was reserved.
  if (session.mode !== "payment" || session.currency !== checkout.currency || session.amount_subtotal !== checkout.amount) return null;
  const { data, error: updateError } = await db.from("checkouts").update({ stripe_session_id: session.id, recovered_at: new Date().toISOString() })
    .eq("id", checkout.id).eq("store_id", storeId).eq("stripe_session_id", original).select("*").maybeSingle();
  if (updateError) throw new Error("Could not adopt the recovered session");
  return (data as Checkout | null) ?? null;
}

/** Checkouts that expired unpaid in the last 30 days and haven't been recovered, newest first. */
export async function listAbandoned(limit = 50): Promise<AbandonedCheckout[]> {
  const since = new Date(Date.now() - RECOVERY_DAYS * 86_400_000).toISOString();
  const { data, error } = await getSupabase().from("checkouts").select("*").eq("store_id", STORE_ID)
    .gte("expired_at", since).is("recovered_at", null).order("expired_at", { ascending: false }).limit(limit);
  if (error) throw new Error("Could not load abandoned checkouts");
  return ((data ?? []) as CheckoutRow[]).map((row) => {
    const item = row.physical_snapshot?.items[0];
    return {
      id: row.id, kind: row.kind === "physical" ? "physical" : "digital", product: item?.name ?? row.product_snapshot?.name ?? row.product_slug,
      productSlug: row.product_slug, amount: row.amount, currency: row.currency, quantity: item?.quantity ?? row.quantity ?? 1,
      expiredAt: row.expired_at!, email: row.recovery_email ?? null, recoveryUrl: row.recovery_url ?? null,
    };
  });
}
