import "server-only";
import { getDeployment, getEnv } from "./env";
import { registrationContactSchema } from "./domain-registration-contact";
import type { DomainPurchase } from "./domain-purchase.types";

export class RegistrarFailure extends Error {
  constructor(public definitive: boolean, public code: string) { super("Domain registration could not be confirmed."); }
}
function assertEnvironment(purchase: DomainPurchase) {
  const deployment = getDeployment();
  if (purchase.origin !== new URL(getEnv().APP_URL).origin || purchase.livemode !== /^(sk|rk)_live_/.test(getEnv().STRIPE_SECRET_KEY)) throw new RegistrarFailure(false, "environment_mismatch");
  if (purchase.livemode && (!deployment.production || process.env.DOMAIN_PURCHASE_MODE !== "live")) throw new RegistrarFailure(false, "registration_disabled");
  if (!purchase.livemode && (deployment.production || process.env.DOMAIN_PURCHASE_MODE !== "sandbox")) throw new RegistrarFailure(false, "sandbox_disabled");
}
export async function submitDomainRegistration(purchase: DomainPurchase): Promise<string> {
  assertEnvironment(purchase);
  if (!purchase.livemode) {
    if (purchase.simulation_scenario === "failure") throw new RegistrarFailure(true, "sandbox_registration_failed");
    if (purchase.simulation_scenario === "uncertain") throw new RegistrarFailure(false, "sandbox_registration_uncertain");
    return `sandbox_${purchase.id}`;
  }
  const contact = registrationContactSchema.safeParse(purchase.contact);
  if (!contact.success) throw new RegistrarFailure(true, "contact_invalid");
  if (!process.env.DOMAIN_VERCEL_TOKEN || !process.env.DOMAIN_VERCEL_TEAM_ID) throw new RegistrarFailure(true, "registrar_not_configured");
  let response: Response;
  try {
    response = await fetch(`https://api.vercel.com/v1/registrar/domains/${encodeURIComponent(purchase.hostname)}/buy?teamId=${encodeURIComponent(process.env.DOMAIN_VERCEL_TEAM_ID)}`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.DOMAIN_VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ autoRenew: purchase.auto_renew, years: purchase.years, expectedPrice: purchase.amount / 100, contactInformation: contact.data }),
      cache: "no-store", signal: AbortSignal.timeout(12000),
    });
  } catch { throw new RegistrarFailure(false, "registrar_timeout"); }
  if (!response.ok) throw new RegistrarFailure([400,401,403,404,409,422].includes(response.status), `registrar_${response.status}`);
  const body = await response.json().catch(() => null);
  if (typeof body?.orderId !== "string" || !body.orderId) throw new RegistrarFailure(false, "registrar_invalid_response");
  return body.orderId;
}
export async function domainRegistrationStatus(purchase: DomainPurchase): Promise<"pending" | "completed" | "failed"> {
  assertEnvironment(purchase);
  if (!purchase.livemode) return purchase.registrar_order_id === `sandbox_${purchase.id}` ? "completed" : "pending";
  if (!purchase.registrar_order_id) throw new RegistrarFailure(false, "missing_registrar_order");
  const response = await fetch(`https://api.vercel.com/v1/registrar/orders/${encodeURIComponent(purchase.registrar_order_id)}?teamId=${encodeURIComponent(process.env.DOMAIN_VERCEL_TEAM_ID!)}`, {
    headers: { Authorization: `Bearer ${process.env.DOMAIN_VERCEL_TOKEN}` }, cache: "no-store", signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) throw new RegistrarFailure(false, "registrar_status_unavailable");
  const order = await response.json().catch(() => null);
  const domain = Array.isArray(order?.domains) ? order.domains.find((entry: Record<string, unknown>) => entry.domainName === purchase.hostname && entry.purchaseType === "purchase") : null;
  if (!domain || order.orderId !== purchase.registrar_order_id || domain.years !== purchase.years || Math.round(domain.price * 100) !== purchase.amount) throw new RegistrarFailure(false, "registrar_order_mismatch");
  if (domain.status === "completed") return "completed";
  if (["failed","refunded","refund-failed"].includes(domain.status)) return "failed";
  return "pending";
}
