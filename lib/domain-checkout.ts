import "server-only";
import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { getDeployment, getEnv } from "./env";
import { HttpError } from "./http";
import { getStripe } from "./stripe";
import { STORE_ID } from "./store-config";
import { domainTestPaymentsEnabled, normalizeDomain } from "./domain-rules";
import { searchDomain } from "./domain-provider";
import type { DomainTestPayment } from "./domain-types";

export const DOMAIN_TEST_APP = "veilcode-domain-test";
export const DOMAIN_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const domainCheckoutCookie = (id: string) => `domain_test_${id}`;

function sandbox() {
  const deployment = getDeployment();
  if (deployment.production || !domainTestPaymentsEnabled()) throw new HttpError(404, "Domain payment testing is available in staging only.");
  return new URL(getEnv().APP_URL).origin;
}

export async function startDomainTestCheckout(input: Record<string, unknown>, ownerId: string) {
  const origin = sandbox();
  if (typeof input.requestId !== "string" || !DOMAIN_REQUEST_ID.test(input.requestId)) throw new HttpError(400, "Start a new payment test.");
  const [quote] = await searchDomain(input.hostname);
  if (!quote?.available || typeof quote.price !== "number" || !Number.isFinite(quote.price) ||
      typeof quote.renewalPrice !== "number" || !Number.isFinite(quote.renewalPrice) || !Number.isInteger(quote.years)) {
    throw new HttpError(409, "This domain cannot be quoted right now. Search again.");
  }
  if (quote.price !== input.expectedPrice || quote.renewalPrice !== input.expectedRenewalPrice || quote.years !== input.expectedYears) {
    throw new HttpError(409, "The quote changed. Search again to review the latest registration and renewal prices.");
  }
  const amount = Math.round(quote.price * 100);
  if (amount < 50 || amount > 10_000_000) throw new HttpError(400, "Choose a domain priced from $0.50 to $100,000 for this payment test.");
  const hash = createHash("sha256").update(`${origin}:${ownerId}:${input.requestId}`).digest("hex");
  const suffix = hash.slice(0, 8).replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  const metadata = {
    app: DOMAIN_TEST_APP, store_id: STORE_ID, owner_id: ownerId, origin,
    domain: quote.domain, amount: String(amount), years: String(quote.years), renewal_amount: String(Math.round(quote.renewalPrice * 100)),
    request_id: input.requestId,
    renewal_requested: input.renew === true ? "true" : "false",
  };
  const session = await getStripe().checkout.sessions.create({
    mode: "payment", ui_mode: "hosted_page", adaptive_pricing: { enabled: false },
    client_reference_id: input.requestId, metadata, payment_intent_data: { metadata },
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: {
      name: `${quote.domain} — test registration`, description: `${quote.years}-year quote. Sandbox payment only; no domain will be registered.`,
    } } }],
    success_url: `${origin}/admin/domains?domain_payment={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/admin/domains?domain_payment_return=cancelled&domain_request=${input.requestId}`,
    custom_text: { submit: { message: "Test payment only. No money moves and no real domain is registered." } },
    integration_identifier: `domain-test-${suffix}`,
  }, { idempotencyKey: `domain-test-${hash}`, maxNetworkRetries: 0, timeout: 15_000 });
  if (session.livemode !== false || !session.id.startsWith("cs_test_") || !session.url) throw new HttpError(503, "The test checkout could not be started. No live purchase is permitted.");
  return { url: session.url, sessionId: session.id, requestId: input.requestId };
}

/** Stripe is the durable source of payment status. This read never registers or fulfils a domain. */
export async function domainTestPayment(id: unknown, ownerId: string): Promise<DomainTestPayment> {
  const origin = sandbox();
  if (typeof id !== "string" || !/^cs_test_[a-zA-Z0-9]{1,240}$/.test(id)) throw new HttpError(400, "Invalid test checkout.");
  let session: Stripe.Checkout.Session;
  try { session = await getStripe().checkout.sessions.retrieve(id, { expand: ["payment_intent"] }, { maxNetworkRetries: 0, timeout: 15_000 }); }
  catch { throw new HttpError(503, "Stripe could not confirm the payment yet. Check again shortly."); }
  const meta = session.metadata;
  const amount = Number(meta?.amount);
  if (session.livemode !== false || session.mode !== "payment" || meta?.app !== DOMAIN_TEST_APP || meta.store_id !== STORE_ID ||
      meta.owner_id !== ownerId || meta.origin !== origin || !normalizeDomain(meta.domain) ||
      session.client_reference_id !== meta.request_id || !Number.isInteger(amount) || amount < 50 ||
      session.currency !== "usd" || session.amount_total !== amount || session.amount_subtotal !== amount) {
    throw new HttpError(404, "This test checkout does not belong to this workspace.");
  }
  const intent = session.payment_intent && typeof session.payment_intent !== "string" ? session.payment_intent : null;
  const status: DomainTestPayment["status"] = session.payment_status === "paid" && session.status === "complete" ? "paid"
    : session.status === "expired" ? "expired"
    : intent?.last_payment_error && intent.status !== "processing" ? "failed"
    : intent?.status === "processing" || session.status === "complete" ? "processing" : "pending";
  return {
    id: session.id, domain: meta.domain, amount, currency: "usd", status,
    checkoutUrl: session.status === "open" ? session.url : null,
    failure: status === "failed" ? "Stripe declined the last payment attempt. Try a different test card in Checkout." : null,
  };
}
