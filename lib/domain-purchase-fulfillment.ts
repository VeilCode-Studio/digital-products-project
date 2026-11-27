import "server-only";
import type Stripe from "stripe";
import { getSupabase } from "./supabase";
import { getStripe } from "./stripe";
import { getEnv } from "./env";
import { HttpError } from "./http";
import { recordDomainPayment, claimDomainRegistration, ownedDomainPurchase, bindDomainCheckout, DOMAIN_PURCHASE_APP } from "./domain-purchase-journal";
import { submitDomainRegistration, domainRegistrationStatus, RegistrarFailure } from "./domain-registrar";
import { connectDomain, checkDomain, searchDomain } from "./domain-provider";
import type { DomainPurchase } from "./domain-purchase.types";

const table = () => getSupabase().from("domain_purchases");
export async function updateDomainPurchase(row: DomainPurchase, patch: Partial<DomainPurchase>) {
  const { data, error } = await table().update(patch).eq("id", row.id).eq("status", row.status).select("*").maybeSingle();
  if (error) throw new HttpError(503, "The domain purchase status could not be saved. Please check again.");
  if (data) return data;
  const current = await ownedDomainPurchase(row.id, { ownerId: row.owner_user_id, storeId: row.store_id, origin: row.origin, livemode: row.livemode });
  if (!current) throw new HttpError(404, "Domain purchase not found.");
  return current;
}
async function refundFailedRegistration(row: DomainPurchase) {
  if (!row.stripe_payment_intent_id) throw new HttpError(409, "The payment reference is missing. Reconciliation is required.");
  if (row.status === "registration_failed") row = await updateDomainPurchase(row, { status: "refund_pending" });
  if (row.status !== "refund_pending") return row;
  const paymentIntentId = row.stripe_payment_intent_id;
  if (!paymentIntentId) throw new HttpError(409, "The payment reference is missing. Reconciliation is required.");
  // Stripe's idempotency cache is finite. Never create another refund after that window without reconciliation.
  if (!row.stripe_refund_id && Date.now() - Date.parse(row.created_at) > 23 * 3600000) return updateDomainPurchase(row, { status: "refund_failed", failure_code: "refund_review_required" });
  try {
    const refund = row.stripe_refund_id ? await getStripe().refunds.retrieve(row.stripe_refund_id)
      : await getStripe().refunds.create({ payment_intent: paymentIntentId, amount: row.amount, metadata: { domain_purchase_id: row.id } }, { idempotencyKey: `domain-refund-${row.id}`, maxNetworkRetries: 0, timeout: 12000 });
    const intent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
    if (refund.amount !== row.amount || intent !== row.stripe_payment_intent_id) throw new Error("Refund mismatch");
    return updateDomainPurchase(row, { stripe_refund_id: refund.id, status: refund.status === "succeeded" ? "refunded" : refund.status === "failed" || refund.status === "canceled" ? "refund_failed" : "refund_pending" });
  } catch { return updateDomainPurchase(row, { failure_code: "refund_confirmation_pending" }); }
}
async function connectRegisteredDomain(row: DomainPurchase) {
  // Sandbox registration never writes real DNS/project assignments.
  if (!row.livemode) return;
  const { data, error } = await getSupabase().from("store_domains").select("*").eq("store_id", row.store_id).eq("product_id", row.product_id).maybeSingle();
  if (error) return;
  try {
    if (!data) await connectDomain(row.product_id, row.hostname, row.store_id);
    else if (data.hostname === row.hostname && data.status !== "active") await checkDomain(data.id, row.store_id);
  } catch { /* Registration remains completed. Connection is a separate retryable operation. */ }
}
export async function advanceDomainPurchase(row: DomainPurchase): Promise<DomainPurchase> {
  if (row.origin !== new URL(getEnv().APP_URL).origin || row.livemode !== /^(sk|rk)_live_/.test(getEnv().STRIPE_SECRET_KEY)) throw new HttpError(409, "Purchase belongs to another payment environment.");
  if (row.status === "paid") {
    const claim = await claimDomainRegistration(row.id);
    if (!claim) return row;
    row = claim;
    let submitted = false;
    try {
      if (row.livemode) {
        const [quote] = await searchDomain(row.hostname);
        if (!quote?.available || quote.years !== row.years || Math.round((quote.price ?? 0) * 100) !== row.amount) throw new RegistrarFailure(true, "registration_quote_changed");
      }
      submitted = true;
      const orderId = await submitDomainRegistration(row);
      row = await updateDomainPurchase(row, { registrar_order_id: orderId, status: "registration_pending" });
      // Live orders are reconciled in a separate request, keeping the webhook inside its execution budget.
      if (row.livemode) return row;
    } catch (error) {
      row = await updateDomainPurchase(row, { status: !submitted || error instanceof RegistrarFailure && error.definitive ? "registration_failed" : "registration_unknown", failure_code: error instanceof RegistrarFailure ? error.code : !submitted ? "registration_preflight_failed" : "registration_confirmation_pending" });
    }
  } else if (row.status === "registering" && Date.now() - Date.parse(row.updated_at) > 5 * 60000) {
    row = await updateDomainPurchase(row, { status: "registration_unknown", failure_code: "registration_confirmation_pending" });
  }
  if (row.status === "registration_pending") {
    try {
      const status = await domainRegistrationStatus(row);
      if (status === "completed") row = await updateDomainPurchase(row, { status: "registered", registered_at: new Date().toISOString(), contact: null });
      if (status === "failed") row = await updateDomainPurchase(row, { status: "registration_failed", failure_code: "registrar_registration_failed" });
    } catch { /* Retain the order reference; status lookup errors never trigger another purchase. */ }
  }
  if (row.status === "registration_failed" || row.status === "refund_pending") row = await refundFailedRegistration(row);
  if (row.status === "registered") await connectRegisteredDomain(row);
  return row;
}

/** Called only after the existing Stripe webhook verifies its signature/account/mode. */
export async function handleDomainPurchaseEvent(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.object !== "checkout.session" || session.metadata?.app !== DOMAIN_PURCHASE_APP) return;
  const { data: row, error } = await table().select("*").eq("id", session.metadata.purchase_id ?? "").maybeSingle();
  if (error) throw new Error("Domain purchase lookup failed");
  if (!row || row.origin !== new URL(getEnv().APP_URL).origin || row.livemode !== event.livemode) return;
  if (event.type === "checkout.session.async_payment_failed" && row.status === "checkout_pending" && row.stripe_session_id === session.id) {
    // Binding revalidates identity and amount without treating an unpaid event as payment success.
    await bindDomainCheckout(row, session);
    await updateDomainPurchase(row, { status: "expired", failure_code: "payment_failed", contact: null }); return;
  }
  if (event.type === "checkout.session.expired" && row.status === "checkout_pending" && row.stripe_session_id === session.id) {
    await updateDomainPurchase(row, { status: "expired", contact: null }); return;
  }
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) || session.payment_status !== "paid") return;
  // Recover a lost create-checkout response using the signed matching session, never a browser-supplied session ID.
  const bound = row.stripe_session_id ? row : await bindDomainCheckout(row, session);
  await recordDomainPayment(bound, session);
  const { data: paid, error: paidError } = await table().select("*").eq("id", row.id).single();
  if (paidError || !paid) throw new Error("Domain payment record unavailable");
  await advanceDomainPurchase(paid);
}
