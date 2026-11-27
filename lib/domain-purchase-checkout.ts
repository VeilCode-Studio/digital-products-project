import "server-only";
import { createHash } from "node:crypto";
import { getStripe } from "./stripe";
import { HttpError } from "./http";
import { domainServiceState, searchDomain } from "./domain-provider";
import { registrationContactSchema } from "./domain-registration-contact";
import { ownedDomainPurchase, saveReviewedDomainPurchase, bindDomainCheckout, DOMAIN_PURCHASE_APP, type DomainPurchaseContext } from "./domain-purchase-journal";
import { getSupabase } from "./supabase";
import { assertDomainName } from "./domains";

export async function startDomainPurchase(input: Record<string, unknown>, context: DomainPurchaseContext) {
  if (input.acceptTerms !== true) throw new HttpError(400, "Accept the registration and payment terms before continuing.");
  const parsed = registrationContactSchema.safeParse(input.contact);
  if (!parsed.success) throw new HttpError(400, "Complete the registrant contact details. Use a phone number with its country code, such as +14155550123.");
  if (typeof input.productId !== "string" || typeof input.requestId !== "string") throw new HttpError(400, "Choose a product and start a new domain review.");
  const existing = await ownedDomainPurchase(input.requestId, context);
  const simulationScenario = context.livemode ? null : input.simulationScenario === "failure" || input.simulationScenario === "uncertain" ? input.simulationScenario : "success";
  if (existing?.stripe_session_id) {
    if (input.expectedPrice !== existing.amount / 100 || input.expectedRenewalPrice !== existing.renewal_amount / 100 || input.expectedYears !== existing.years) throw new HttpError(409, "This purchase request changed. Start a new review.");
    await saveReviewedDomainPurchase({ id: input.requestId, productId: input.productId, hostname: assertDomainName(input.hostname),
      amount: existing.amount, renewalAmount: existing.renewal_amount, years: existing.years, autoRenew: input.renew === true,
      contact: parsed.data, simulationScenario }, context);
    const session = await getStripe().checkout.sessions.retrieve(existing.stripe_session_id, {}, { timeout: 12000, maxNetworkRetries: 0 })
      .catch(() => { throw new HttpError(503, "Checkout could not be confirmed. Check this purchase before trying again."); });
    return { url: session.status === "open" ? session.url : null, purchaseId: existing.id };
  }
  if (existing && Date.now() - Date.parse(existing.created_at) > 23 * 3600000) throw new HttpError(409, "This checkout needs reconciliation before another payment can be started.");
  // A replay is still validated against its original terms/contact by saveReviewedDomainPurchase.
  const hostname = assertDomainName(input.hostname);
  const [quotes, schemaResponse, service] = await Promise.all([
    searchDomain(hostname),
    fetch(`https://api.vercel.com/v1/registrar/domains/${encodeURIComponent(hostname)}/contact-info/schema`, { cache: "no-store", signal: AbortSignal.timeout(12000) }).catch(() => null),
    context.livemode ? domainServiceState() : Promise.resolve({ ready: true, message: "" }),
  ]);
  const [quote] = quotes;
  if (!quote?.available || !quote.price || !quote.renewalPrice || !quote.years) throw new HttpError(409, "This domain cannot be purchased right now. Search again.");
  if (quote.price !== input.expectedPrice || quote.renewalPrice !== input.expectedRenewalPrice || quote.years !== input.expectedYears) throw new HttpError(409, "The registration or renewal quote changed. Search again to review the latest price.");
  if (quote.domain.split(".").some((part) => part.startsWith("xn--"))) throw new HttpError(400, "Internationalized domain registration needs language details that are not supported yet.");
  if (!schemaResponse?.ok) throw new HttpError(503, "The registrar's contact requirements could not be checked. Please try again.");
  const schema = await schemaResponse.json().catch(() => null);
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new HttpError(503, "The registrar returned invalid contact requirements.");
  // Fail before payment for extensions requiring additional forms rather than buying with incomplete contacts.
  if (Object.keys(schema).length) throw new HttpError(400, "This domain extension requires additional registration details that are not supported yet. Choose another extension.");
  if (!service.ready) throw new HttpError(503, service.message);
  const { data: connected, error: connectionError } = await getSupabase().from("store_domains").select("id").eq("store_id", context.storeId).eq("product_id", input.productId).maybeSingle();
  if (connectionError) throw new HttpError(503, "Domain connections could not be checked.");
  if (connected) throw new HttpError(409, "This product already has a domain. Remove its current connection before buying another.");
  const purchase = await saveReviewedDomainPurchase({ id: input.requestId, productId: input.productId, hostname: quote.domain,
    amount: Math.round(quote.price * 100), renewalAmount: Math.round(quote.renewalPrice * 100), years: quote.years,
    autoRenew: input.renew === true, contact: parsed.data,
    simulationScenario,
  }, context);
  const metadata = { app: DOMAIN_PURCHASE_APP, purchase_id: purchase.id, domain: purchase.hostname,
    store_id: purchase.store_id, owner_id: purchase.owner_user_id, origin: purchase.origin };
  const suffix = createHash("sha256").update(purchase.id).digest("hex").slice(0, 8).replace(/[0-9a-f]/g, (d) => String.fromCharCode(97 + parseInt(d, 16)));
  const session = await getStripe().checkout.sessions.create({
    mode: "payment", ui_mode: "hosted_page", adaptive_pricing: { enabled: false }, client_reference_id: purchase.id,
    metadata, payment_intent_data: { metadata }, customer_email: parsed.data.email,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: purchase.amount, product_data: {
      name: `${purchase.hostname} — ${context.livemode ? "domain registration" : "sandbox registration"}`,
      description: `${purchase.years} year registration${context.livemode ? "" : ". Test payment and simulated registration; no real domain is bought"}.`,
    } } }],
    success_url: `${purchase.origin}/admin/domains?purchase=${purchase.id}`,
    cancel_url: `${purchase.origin}/admin/domains?purchase=${purchase.id}`,
    integration_identifier: `domain-purchase-${suffix}`,
    custom_text: { submit: { message: context.livemode ? "Payment is followed by domain registration. Failed registration is refunded; successful registrations are non-refundable." : "Sandbox only: no real money moves and no real domain is registered." } },
  }, { idempotencyKey: `domain-purchase-${purchase.id}`, maxNetworkRetries: 0, timeout: 15000 })
    .catch(() => { throw new HttpError(503, "Checkout could not be confirmed. Retry this same review to recover it; do not start another purchase."); });
  await bindDomainCheckout(purchase, session);
  if (!session.url) throw new HttpError(503, "Checkout is not available. Check this purchase before trying again.");
  return { url: session.url, purchaseId: purchase.id };
}
