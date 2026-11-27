import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { resetFakes, seedProduct, state, OWNER_ID, sessionsCreate, refundsCreate, sendEmail, rpc } from "./fakes";
import { stubDevelopment } from "./env";
import { STORE_ID } from "../lib/store-config";
import { startDomainPurchase } from "../lib/domain-purchase-checkout";
import { domainPurchaseContext, domainPurchaseMode } from "../lib/domain-purchase-mode";
import { domainPurchaseStatus } from "../lib/domain-purchase-status";
import { handleStripeWebhook } from "../lib/stripe-webhook";
import { advanceDomainPurchase } from "../lib/domain-purchase-fulfillment";
import { GET, POST } from "../app/api/admin/domain-purchases/route";

const login = vi.hoisted(() => ({ token: "owner-token" as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => login.token ? { value: login.token } : undefined }) }));

const quote = { domain: "leadtokickoff.com", available: true, years: 1, price: 6.99, renewalPrice: 12.03 };
const contact = { firstName: "Domain", lastName: "Test", email: "domain-test@example.com", phone: "+14155550123", address1: "123 Test Street", address2: "", city: "San Francisco", state: "CA", zip: "94105", country: "US", companyName: "" };
const input = () => ({ requestId: randomUUID(), productId: "domain-product", hostname: quote.domain, expectedPrice: quote.price, expectedRenewalPrice: quote.renewalPrice, expectedYears: quote.years, renew: false, contact, acceptTerms: true });
const context = () => domainPurchaseContext(OWNER_ID, STORE_ID);
const webhook = (session: object) => handleStripeWebhook(new Request("http://localhost:3000/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "verified-by-test-adapter" }, body: JSON.stringify({ type: "checkout.session.completed", livemode: false, data: { object: session } }) }));
beforeEach(() => {
  resetFakes(); rpc.mockClear(); login.token = "owner-token";
  stubDevelopment({ DOMAIN_PURCHASE_MODE: "sandbox", DOMAIN_PURCHASE_PREVIEW: "true", VERCEL_TARGET_ENV: "" });
  seedProduct({ id: "domain-product" });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/contact-info/schema")) return Response.json({});
    if (url.endsWith("/search")) return Response.json({ results: [quote] });
    throw new Error("Unexpected provider call in sandbox");
  }));
  sessionsCreate.mockImplementation(async (body, options) => {
    const previous = [...state.sessions.values()].find((s) => s._key === options?.idempotencyKey);
    if (previous) return previous;
    const session = { id: `cs_test_${state.sessions.size}`, object: "checkout.session", status: "open", payment_status: "unpaid", livemode: false,
      mode: body.mode, currency: "usd", amount_total: 699, amount_subtotal: 699, client_reference_id: body.client_reference_id,
      metadata: body.metadata, payment_intent: null, url: "https://checkout.stripe.com/c/pay/test", _key: options?.idempotencyKey };
    state.sessions.set(session.id, session); return session;
  });
});
async function checkout(scenario = "success") {
  const request = { ...input(), simulationScenario: scenario };
  const result = await startDomainPurchase(request, context());
  const row = state.domain_purchases[0];
  return { request, result, row, session: state.sessions.get(row.stripe_session_id!)! };
}
function paid(session: Record<string, unknown>) { return { ...session, status: "complete", payment_status: "paid", payment_intent: "pi_domain" }; }

it("freezes contact/terms, creates an idempotent server-priced checkout, and reopens the same session", async () => {
  const { request, result, row } = await checkout();
  expect(row).toMatchObject({ amount: 699, renewal_amount: 1203, terms_version: "2026-11-27-v1", contact, status: "checkout_pending" });
  const [body, options] = sessionsCreate.mock.calls[0];
  expect(body).toMatchObject({ client_reference_id: row.id, line_items: [{ quantity: 1, price_data: { unit_amount: 699, currency: "usd" } }] });
  expect(body).not.toHaveProperty("payment_method_types");
  expect(body.success_url).toContain(`purchase=${row.id}`);
  expect(options.idempotencyKey).toBe(`domain-purchase-${row.id}`);
  expect(await startDomainPurchase(request, context())).toEqual(result);
  expect(sessionsCreate).toHaveBeenCalledTimes(1);
  await expect(startDomainPurchase({ ...request, contact: { ...contact, email: "other@example.com" } }, context())).rejects.toMatchObject({ status: 409 });
});
it("rejects missing consent, invalid contact, changed quotes and foreign products before payment", async () => {
  for (const changed of [{ acceptTerms: false }, { contact: { ...contact, country: "ZZ" } }, { expectedPrice: 1 }, { productId: "foreign" }]) {
    await expect(startDomainPurchase({ ...input(), ...changed }, context())).rejects.toThrow();
  }
  expect(sessionsCreate).not.toHaveBeenCalled(); expect(state.domain_purchases).toHaveLength(0);
});
it("does not fulfil from a status read; verified payment and reconciliation complete a simulated registration", async () => {
  const { row, session } = await checkout();
  state.sessions.set(String(session.id), paid(session));
  expect(await domainPurchaseStatus(row.id, context())).toMatchObject({ status: "checkout_pending", paymentStatus: "paid" });
  expect(rpc).not.toHaveBeenCalled();
  const result = await domainPurchaseStatus(row.id, context(), true);
  expect(result).toMatchObject({ status: "registered", paymentStatus: "paid", connectionStatus: "simulation", sandbox: true });
  expect(result).not.toHaveProperty("contact"); expect(result).not.toHaveProperty("stripe_payment_intent_id");
  expect(state.store_domains).toHaveLength(0); expect(state.orders).toHaveLength(0); expect(sendEmail).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("/buy"))).toBe(true);
});
it("processes repeated signed webhooks once without merchandise fulfillment", async () => {
  const { session } = await checkout();
  const event = paid(session);
  expect((await webhook(event)).status).toBe(200);
  expect((await webhook(event)).status).toBe(200);
  expect(state.domain_purchases[0].status).toBe("registered");
  expect(rpc.mock.calls.filter(([name]) => name === "claim_domain_registration")).toHaveLength(1);
  expect(state.orders).toHaveLength(0); expect(sendEmail).not.toHaveBeenCalled();
});
it("recovers a lost checkout binding from the signed matching paid session", async () => {
  const { session } = await checkout();
  state.domain_purchases[0].stripe_session_id = null;
  expect((await webhook(paid(session))).status).toBe(200);
  expect(state.domain_purchases[0]).toMatchObject({ status: "registered", stripe_session_id: session.id });
});
it("rejects a paid event with a changed amount and leaves the purchase unpaid", async () => {
  const { session } = await checkout();
  expect((await webhook({ ...paid(session), amount_total: 1 })).status).toBe(500);
  expect(state.domain_purchases[0].status).toBe("checkout_pending"); expect(refundsCreate).not.toHaveBeenCalled();
});
it("fully refunds a failed simulated registration and does not refund again on replay", async () => {
  const { session } = await checkout("failure");
  await webhook(paid(session)); await webhook(paid(session));
  expect(state.domain_purchases[0]).toMatchObject({ status: "refunded", stripe_refund_id: "re_test_1" });
  expect(refundsCreate).toHaveBeenCalledTimes(1);
  expect(refundsCreate.mock.calls[0][0]).toMatchObject({ payment_intent: "pi_domain", amount: 699 });
});
it("retains an uncertain registrar outcome without retrying the purchase or refunding blindly", async () => {
  const { row, session } = await checkout("uncertain");
  await webhook(paid(session));
  expect(state.domain_purchases[0].status).toBe("registration_unknown");
  await domainPurchaseStatus(row.id, context(), true);
  expect(rpc.mock.calls.filter(([name]) => name === "claim_domain_registration")).toHaveLength(1);
  expect(refundsCreate).not.toHaveBeenCalled();
});
it("keeps a refund timeout pending and retries with the same Stripe idempotency key", async () => {
  const { session } = await checkout("failure");
  refundsCreate.mockRejectedValueOnce(new Error("timeout"));
  await webhook(paid(session));
  expect(state.domain_purchases[0].status).toBe("refund_pending");
  await advanceDomainPurchase(state.domain_purchases[0]);
  expect(state.domain_purchases[0].status).toBe("refunded");
  expect(refundsCreate.mock.calls[0][1].idempotencyKey).toBe(refundsCreate.mock.calls[1][1].idempotencyKey);
});
it("isolates status access by owner and payment environment", async () => {
  const { row } = await checkout();
  await expect(domainPurchaseStatus(row.id, { ...context(), ownerId: randomUUID() })).rejects.toMatchObject({ status: 404 });
  await expect(domainPurchaseStatus(row.id, { ...context(), livemode: true })).rejects.toMatchObject({ status: 404 });
  vi.stubEnv("VERCEL_TARGET_ENV", "production");
  expect(domainPurchaseMode()).toBeNull();
});
it("requires authentication and a same-origin POST before creating a checkout", async () => {
  login.token = null;
  expect((await GET(new Request(`http://localhost:3000/api/admin/domain-purchases?id=${randomUUID()}`))).status).toBe(401);
  const request = (origin: string) => new Request("http://localhost:3000/api/admin/domain-purchases", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(input()) });
  expect((await POST(request("http://localhost:3000"))).status).toBe(401);
  login.token = "owner-token";
  expect((await POST(request("https://other.example.com"))).status).toBe(403);
  expect(sessionsCreate).not.toHaveBeenCalled();
});
it("recovers checkout using the stored review rather than a new browser quote", async () => {
  const { row, result } = await checkout();
  const response = await POST(new Request("http://localhost:3000/api/admin/domain-purchases", { method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify({ action: "resume_checkout", id: row.id, expectedPrice: 1, contact: { email: "tampered@example.com" } }) }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
  expect(sessionsCreate).toHaveBeenCalledTimes(1);
});
