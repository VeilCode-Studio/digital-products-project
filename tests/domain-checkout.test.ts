import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, sessionsCreate, sessionsRetrieve, state, sendEmail, OWNER_ID } from "./fakes";
import { stubDevelopment } from "./env";
import { startDomainTestCheckout, domainTestPayment, DOMAIN_TEST_APP } from "../lib/domain-checkout";
import { domainTestPaymentsEnabled } from "../lib/domain-rules";
import { handleStripeWebhook } from "../lib/stripe-webhook";
import { POST, GET } from "../app/api/admin/domain-checkout/route";
import { STORE_ID } from "../lib/store-config";

const login = vi.hoisted(() => ({ token: "owner-token" as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => login.token ? { value: login.token } : undefined }) }));
const input = () => ({ hostname: "leadtokickoff.com", requestId: randomUUID(), expectedPrice: 6.99, expectedRenewalPrice: 12.03, expectedYears: 1, renew: true });
const quote = { domain: "leadtokickoff.com", available: true, years: 1, price: 6.99, renewalPrice: 12.03, premium: false };
const session = (overrides: Record<string, unknown> = {}) => ({
  id: "cs_test_domain123", object: "checkout.session", livemode: false, mode: "payment", status: "open", payment_status: "unpaid",
  amount_subtotal: 699, amount_total: 699, currency: "usd", client_reference_id: "request-1", url: "https://checkout.stripe.com/c/pay/test",
  metadata: { app: DOMAIN_TEST_APP, store_id: STORE_ID, owner_id: OWNER_ID, origin: "http://localhost:3000", domain: quote.domain, amount: "699", request_id: "request-1" },
  payment_intent: null, ...overrides,
});
beforeEach(() => {
  resetFakes(); login.token = "owner-token";
  stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true", DOMAIN_TEST_PAYMENTS: "true" });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ results: [quote] })));
  sessionsCreate.mockResolvedValue(session()); sessionsRetrieve.mockResolvedValue(session());
});

describe("domain sandbox checkout", () => {
  it("creates a server-priced test session with idempotency and separate domain metadata", async () => {
    const request = input();
    expect(await startDomainTestCheckout(request, OWNER_ID)).toMatchObject({ sessionId: "cs_test_domain123" });
    const [body, options] = sessionsCreate.mock.calls[0];
    expect(body).toMatchObject({ mode: "payment", metadata: { app: DOMAIN_TEST_APP, domain: quote.domain, owner_id: OWNER_ID, amount: "699", renewal_requested: "true" }, line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: 699 } }] });
    expect(body.success_url).toBe("http://localhost:3000/admin/domains?domain_payment={CHECKOUT_SESSION_ID}");
    expect(body.cancel_url).toContain(request.requestId);
    expect(body.payment_intent_data.metadata).toEqual(body.metadata);
    expect(body).not.toHaveProperty("payment_method_types");
    expect(options.idempotencyKey).toMatch(/^domain-test-/);
    await startDomainTestCheckout(request, OWNER_ID);
    expect(sessionsCreate.mock.calls[1][1].idempotencyKey).toBe(options.idempotencyKey);
    expect(state.orders).toHaveLength(0); expect(sendEmail).not.toHaveBeenCalled();
  });
  it("rejects tampered prices and changed renewal terms before starting payment", async () => {
    for (const change of [{ expectedPrice: 0.01 }, { expectedRenewalPrice: 1 }, { expectedYears: 2 }]) {
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [quote] }));
      await expect(startDomainTestCheckout({ ...input(), ...change }, OWNER_ID)).rejects.toMatchObject({ status: 409 });
    }
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
  it("is refused in production even with a test key and all feature flags enabled", async () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("DEPLOYMENT_ENV", "production");
    vi.stubEnv("APP_URL", "https://delivery.example.com"); vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    // getDeployment also checks project keys, so use the production defaults from the shared setup.
    const { fakeSupabaseKey } = await import("./env");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", fakeSupabaseKey("service_role")); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", fakeSupabaseKey("anon"));
    expect(domainTestPaymentsEnabled()).toBe(false);
    await expect(startDomainTestCheckout(input(), OWNER_ID)).rejects.toMatchObject({ status: 404 });
    expect(sessionsCreate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("does not enable checkout with a live Stripe key or a disabled flag", async () => {
    expect(domainTestPaymentsEnabled({ DOMAIN_TEST_PAYMENTS: "true", DOMAIN_PURCHASE_PREVIEW: "true", DEPLOYMENT_ENV: "preview", STRIPE_SECRET_KEY: "sk_live_example" })).toBe(false);
    vi.stubEnv("DOMAIN_TEST_PAYMENTS", "false");
    await expect(startDomainTestCheckout(input(), OWNER_ID)).rejects.toMatchObject({ status: 404 });
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
  it("does not accept an unexpected live-mode session response", async () => {
    sessionsCreate.mockResolvedValueOnce(session({ livemode: true, id: "cs_live_wrong" }));
    await expect(startDomainTestCheckout(input(), OWNER_ID)).rejects.toMatchObject({ status: 503 });
  });
});

describe("verified payment outcomes", () => {
  it.each([
    [{ status: "complete", payment_status: "paid" }, "paid"],
    [{ status: "expired" }, "expired"],
    [{ payment_intent: { status: "requires_payment_method", last_payment_error: { code: "card_declined" } } }, "failed"],
    [{ payment_intent: { status: "processing", last_payment_error: null } }, "processing"],
    [{ status: "complete", payment_status: "unpaid" }, "processing"],
    [{}, "pending"],
  ])("reads %j from Stripe as %s", async (change, status) => {
    sessionsRetrieve.mockResolvedValueOnce(session(change));
    expect(await domainTestPayment("cs_test_domain123", OWNER_ID)).toMatchObject({ status, amount: 699, domain: quote.domain });
  });
  it("allows a declined session to be retried and then become paid", async () => {
    sessionsRetrieve.mockResolvedValueOnce(session({ payment_intent: { status: "requires_payment_method", last_payment_error: { code: "card_declined" } } }));
    expect(await domainTestPayment("cs_test_domain123", OWNER_ID)).toMatchObject({ status: "failed", checkoutUrl: expect.stringContaining("checkout.stripe.com") });
    sessionsRetrieve.mockResolvedValueOnce(session({ status: "complete", payment_status: "paid", url: null }));
    expect(await domainTestPayment("cs_test_domain123", OWNER_ID)).toMatchObject({ status: "paid", checkoutUrl: null });
  });
  it.each([{ livemode: true }, { amount_total: 1 }, { currency: "gbp" }, { metadata: { ...session().metadata, owner_id: "someone-else" } }, { metadata: { ...session().metadata, origin: "https://staging.example.com" } }, { metadata: { ...session().metadata, app: "veilcode-store" } }])("rejects unrelated or mismatched sessions: %j", async (change) => {
    sessionsRetrieve.mockResolvedValueOnce(session(change));
    await expect(domainTestPayment("cs_test_domain123", OWNER_ID)).rejects.toMatchObject({ status: 404 });
  });
  it("does not trust browser success flags or live session IDs", async () => {
    await expect(domainTestPayment("cs_live_123?success=true", OWNER_ID)).rejects.toMatchObject({ status: 400 });
    expect(sessionsRetrieve).not.toHaveBeenCalled();
  });
});

describe("authenticated routes and webhook isolation", () => {
  const request = (origin = "http://localhost:3000") => new Request("http://localhost:3000/api/admin/domain-checkout", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(input()) });
  it("requires an owner and platform Origin", async () => {
    login.token = null;
    expect((await POST(request())).status).toBe(401);
    expect((await GET(new Request("http://localhost:3000/api/admin/domain-checkout?session=cs_test_domain123"))).status).toBe(401);
    login.token = "owner-token";
    expect((await POST(request("https://unrelated.example"))).status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
  it("sets an HTTP-only, request-scoped cancellation locator after creating checkout", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Path=/admin/domains");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"])("acknowledges %s without registering domains or fulfilling products", async (type) => {
    const response = await handleStripeWebhook(new Request("http://localhost:3000/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": "signed-test" }, body: JSON.stringify({ type, livemode: false, data: { object: session({ status: "complete", payment_status: "paid" }) } }) }));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ domainTest: true });
    expect(state.orders).toHaveLength(0); expect(sendEmail).not.toHaveBeenCalled();
  });
});
