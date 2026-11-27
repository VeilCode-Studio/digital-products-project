import "server-only";
import { getStripe } from "./stripe";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { ownedDomainPurchase, recordDomainPayment, type DomainPurchaseContext } from "./domain-purchase-journal";
import { advanceDomainPurchase, updateDomainPurchase } from "./domain-purchase-fulfillment";

export async function domainPurchaseStatus(id: string, context: DomainPurchaseContext, reconcile = false) {
  let row = await ownedDomainPurchase(id, context);
  if (!row) throw new HttpError(404, "Domain purchase not found.");
  let paymentStatus = row.status === "checkout_pending" ? "pending" : row.status === "expired" ? row.failure_code === "payment_failed" ? "failed" : "expired" : "paid";
  let checkoutUrl: string | null = null;
  if (row.status === "checkout_pending" && row.stripe_session_id) {
    const session = await getStripe().checkout.sessions.retrieve(row.stripe_session_id, { expand: ["payment_intent"] }, { timeout: 12000, maxNetworkRetries: 0 }).catch(() => null);
    if (!session) throw new HttpError(503, "Stripe could not confirm the latest payment status. Please check again.");
    const intent = session.payment_intent && typeof session.payment_intent !== "string" ? session.payment_intent : null;
    paymentStatus = session.payment_status === "paid" && session.status === "complete" ? "paid" : session.status === "expired" ? "expired"
      : intent?.status === "processing" ? "processing" : intent?.last_payment_error ? "failed" : session.status === "complete" ? "processing" : "pending";
    checkoutUrl = session.status === "open" ? session.url : null;
    if (reconcile && paymentStatus === "paid") {
      await recordDomainPayment(row, session);
      row = (await ownedDomainPurchase(id, context))!;
    } else if (reconcile && paymentStatus === "expired") row = await updateDomainPurchase(row, { status: "expired", contact: null });
  }
  if (reconcile) row = await advanceDomainPurchase(row);
  const { data: connection } = await getSupabase().from("store_domains").select("status,hostname").eq("store_id", context.storeId).eq("product_id", row.product_id).maybeSingle();
  return { id: row.id, domain: row.hostname, amount: row.amount, years: row.years, autoRenew: row.auto_renew,
    sandbox: !row.livemode, status: row.status, paymentStatus, checkoutUrl,
    connectionStatus: !row.livemode ? "simulation" : connection?.hostname === row.hostname ? connection.status : "not_connected",
    failure: row.failure_code && row.status !== "registered" ? row.failure_code === "payment_failed" ? "Payment failed. No domain registration was attempted."
      : row.status === "registration_unknown" ? "Registration could not be confirmed. Do not start another purchase; this order needs reconciliation."
      : row.status === "refund_failed" ? "The refund needs review. Your payment and domain purchase references have been retained."
      : "Registration was unsuccessful. Check the refund status below." : null,
  };
}
export type DomainPurchaseSummary = Awaited<ReturnType<typeof domainPurchaseStatus>>;
