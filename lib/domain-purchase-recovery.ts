import "server-only";
import { getEnv } from "./env";
import { getSupabase } from "./supabase";
import { advanceDomainPurchase, updateDomainPurchase } from "./domain-purchase-fulfillment";
import { getStripe } from "./stripe";
import { recordDomainPayment } from "./domain-purchase-journal";
import { domainPurchaseMode } from "./domain-purchase-mode";
export async function recoverDomainPurchases() {
  if (!domainPurchaseMode()) return { checked: 0 };
  const origin = new URL(getEnv().APP_URL).origin;
  const livemode = /^(sk|rk)_live_/.test(getEnv().STRIPE_SECRET_KEY);
  const { data, error } = await getSupabase().from("domain_purchases").select("*")
    .eq("origin", origin).eq("livemode", livemode).in("status", ["checkout_pending","paid","registering","registration_pending","registration_failed","refund_pending"])
    .order("updated_at").limit(1);
  if (error) throw new Error("Domain purchase recovery lookup failed");
  for (const row of data ?? []) {
    if (row.status === "checkout_pending") {
      if (row.stripe_session_id) {
        const session = await getStripe().checkout.sessions.retrieve(row.stripe_session_id, {}, { timeout: 12000, maxNetworkRetries: 0 });
        if (session.payment_status === "paid" && session.status === "complete") await recordDomainPayment(row, session);
        else if (session.status === "expired") await updateDomainPurchase(row, { status: "expired", contact: null });
        else await updateDomainPurchase(row, {});
      } else await updateDomainPurchase(row, {});
      // Isolate payment recovery from registration so an external outage cannot exhaust the worker budget.
      continue;
    }
    const result = await advanceDomainPurchase(row);
    if (["registration_pending","refund_pending"].includes(result.status)) await updateDomainPurchase(result, {});
  }
  return { checked: data?.length ?? 0 };
}
