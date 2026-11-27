import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { resetFakes, state, seedProduct, OWNER_ID } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { domainPurchaseMatchesSession, saveReviewedDomainPurchase, ownedDomainPurchase, recordDomainPayment, bindDomainCheckout, DOMAIN_PURCHASE_APP } from "../lib/domain-purchase-journal";
import type { DomainPurchase } from "../lib/domain-purchase.types";

const context = { storeId: STORE_ID, ownerId: OWNER_ID, origin: "https://staging.example.com", livemode: false };
const review = () => ({ id: randomUUID(), productId: "domain-product", hostname: "mybrand.com", amount: 699, renewalAmount: 1203, years: 1, autoRenew: false, contact: { email: "test@example.com", firstName: "Test" } });
beforeEach(() => { resetFakes(); seedProduct({ id: "domain-product" }); });

it("replays the same reviewed request without creating another purchase, regardless of object-key order", async () => {
  const input = review();
  const first = await saveReviewedDomainPurchase(input, context);
  const second = await saveReviewedDomainPurchase({ ...input, contact: { firstName: "Test", email: "test@example.com" } }, context);
  expect(second.id).toBe(first.id);
  expect(state.domain_purchases).toHaveLength(1);
  await expect(saveReviewedDomainPurchase({ ...input, amount: 799 }, context)).rejects.toMatchObject({ status: 409 });
});
it("checks both store ownership and product ownership before saving a purchase", async () => {
  await expect(saveReviewedDomainPurchase(review(), { ...context, ownerId: randomUUID() })).rejects.toMatchObject({ status: 403 });
  await expect(saveReviewedDomainPurchase({ ...review(), productId: "foreign-product" }, context)).rejects.toMatchObject({ status: 404 });
  expect(state.domain_purchases).toHaveLength(0);
});
it("does not return another owner, store, deployment, or payment mode's purchase", async () => {
  const saved = await saveReviewedDomainPurchase(review(), context);
  for (const changed of [{ ownerId: randomUUID() }, { storeId: randomUUID() }, { origin: "https://other.example.com" }, { livemode: true }]) {
    expect(await ownedDomainPurchase(saved.id, { ...context, ...changed })).toBeNull();
  }
});
function paidSession(row: DomainPurchase): Stripe.Checkout.Session {
  return { id: "cs_test_journal", livemode: false, mode: "payment", payment_status: "paid", status: "complete", amount_total: row.amount, amount_subtotal: row.amount, currency: "usd",
    client_reference_id: row.id, payment_intent: "pi_journal", metadata: { app: DOMAIN_PURCHASE_APP, purchase_id: row.id, store_id: row.store_id, owner_id: row.owner_user_id, origin: row.origin, domain: row.hostname } } as unknown as Stripe.Checkout.Session;
}
it("accepts only a completed payment matching the frozen purchase and bound Stripe session", async () => {
  const row = await saveReviewedDomainPurchase(review(), context);
  row.stripe_session_id = "cs_test_journal";
  const session = paidSession(row);
  expect(domainPurchaseMatchesSession(row, session)).toBe(true);
  for (const changed of [{ payment_status: "unpaid" }, { amount_total: 1 }, { livemode: true }, { id: "cs_test_other" }, { currency: "gbp" }, { status: "open" }, { metadata: { ...session.metadata, owner_id: "someone-else" } }]) {
    expect(domainPurchaseMatchesSession(row, { ...session, ...changed } as Stripe.Checkout.Session)).toBe(false);
  }
});
it("records matching payment once and rejects a different payment reference on replay", async () => {
  const saved = await saveReviewedDomainPurchase(review(), context);
  state.domain_purchases[0].stripe_session_id = "cs_test_journal";
  const row = { ...saved, stripe_session_id: "cs_test_journal" };
  await recordDomainPayment(row, paidSession(row));
  expect(state.domain_purchases[0]).toMatchObject({ status: "paid", stripe_payment_intent_id: "pi_journal" });
  await recordDomainPayment(state.domain_purchases[0], paidSession(row));
  await expect(recordDomainPayment(state.domain_purchases[0], { ...paidSession(row), payment_intent: "pi_other" })).rejects.toMatchObject({ status: 409 });
});
it("binds only one matching Checkout session and accepts its idempotent replay", async () => {
  const row = await saveReviewedDomainPurchase(review(), context);
  const checkout = { ...paidSession(row), payment_status: "unpaid", status: "open" } as Stripe.Checkout.Session;
  expect((await bindDomainCheckout(row, checkout)).stripe_session_id).toBe(checkout.id);
  expect((await bindDomainCheckout(row, checkout)).stripe_session_id).toBe(checkout.id);
  await expect(bindDomainCheckout(row, { ...checkout, id: "cs_test_second" })).rejects.toMatchObject({ status: 409 });
});
it("refuses to silently discard payment when its purchase changed concurrently", async () => {
  const saved = await saveReviewedDomainPurchase(review(), context);
  state.domain_purchases[0].stripe_session_id = "cs_test_journal";
  const stale = { ...state.domain_purchases[0] };
  state.domain_purchases[0].status = "expired";
  await expect(recordDomainPayment(stale, paidSession(stale))).rejects.toMatchObject({ status: 409 });
  expect(state.domain_purchases[0].status).toBe("expired");
  expect(saved.id).toBe(stale.id);
});
