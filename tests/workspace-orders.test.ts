import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, seedOrder, seedPhysicalOrder, state, refundsCreate, sessionsRetrieve, sendEmail } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { recentOrders } from "../lib/dashboard";
import { listPhysicalOrders, fulfillmentCounts, applyFulfillment } from "../lib/fulfillment";
import { refundOrder } from "../lib/order-delays";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined }) }));
import { GET as exportOrders } from "../app/api/admin/orders/export/route";
import { POST as resend } from "../app/api/admin/orders/resend/route";
import { POST as legacyResend } from "../app/api/admin/resend/route";
import { POST as fulfillment } from "../app/api/admin/fulfillment/route";
import { POST as cjFulfillment } from "../app/api/admin/fulfillment/cj/route";
const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
beforeEach(() => {
  resetFakes(); jar.clear();
  state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: randomUUID(), name: "Other store" });
});
function ownerMoves() {
  state.stores[0].owner_user_id = null; state.stores[1].owner_user_id = OWNER_ID; jar.set("veilcode_owner", "owner-token");
}
function post(body: Record<string, unknown>) {
  return new Request("https://delivery.example.com/api/admin/fulfillment", { method: "POST", headers: { origin: "https://delivery.example.com", "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function account(storeId = otherStore) {
  const now = new Date().toISOString();
  const row = { id: randomUUID(), store_id: storeId, provider: "stripe" as const, external_account_id: "acct_merchant", livemode: false, is_current: false, status: "disconnected" as const, charges_enabled: false, payouts_enabled: false, country: "GB", requirements: [], created_at: now, updated_at: now };
  state.payment_connections.push(row); return row;
}
it("isolates order lists, counts and CSV exports to the database-owned workspace", async () => {
  const original = seedPhysicalOrder({ email: "original-buyer@example.com" });
  const own = seedPhysicalOrder({ store_id: otherStore, email: "merchant-buyer@example.com" });
  expect((await recentOrders(100, otherStore)).map(o => o.id)).toEqual([own.id]);
  expect((await listPhysicalOrders("needs_ordering", otherStore)).map(o => o.id)).toEqual([own.id]);
  expect((await fulfillmentCounts(otherStore)).needs_ordering).toBe(1);
  ownerMoves();
  const response = await exportOrders(); const csv = await response.text();
  expect(response.status).toBe(200); expect(csv).toContain(own.email); expect(csv).not.toContain(original.email);
});
it("rejects foreign resends and fulfillment before email, refund, or mutation", async () => {
  ownerMoves(); const order = seedOrder(); const physical = seedPhysicalOrder();
  expect((await resend(post({ sessionId: order.stripe_session_id, storeId: STORE_ID }))).status).toBe(404);
  expect((await fulfillment(post({ orderId: physical.id, expected: "needs_ordering", action: "cancelled", refund: true, storeId: STORE_ID }))).status).toBe(404);
  expect(physical.fulfillment_status).toBe("needs_ordering"); expect(sendEmail).not.toHaveBeenCalled(); expect(refundsCreate).not.toHaveBeenCalled();
});
it("updates the owned physical order through the scoped fulfillment endpoint", async () => {
  ownerMoves(); const order = seedPhysicalOrder({ store_id: otherStore });
  const response = await fulfillment(post({ orderId: order.id, expected: "needs_ordering", action: "ordered", supplierRef: "ORDER-1" }));
  expect(response.status).toBe(200); expect(order).toMatchObject({ fulfillment_status: "ordered", supplier_order_ref: "ORDER-1" });
});
it("does not refund independent merchant orders through a missing or foreign payment account", async () => {
  const order = seedPhysicalOrder({ store_id: otherStore });
  await expect(refundOrder(order)).rejects.toThrow("Payment account not found");
  order.payment_connection_id = account(STORE_ID).id;
  await expect(refundOrder(order)).rejects.toThrow("Payment account not found");
  expect(sessionsRetrieve).not.toHaveBeenCalled(); expect(refundsCreate).not.toHaveBeenCalled();
});
it("refunds on the historical merchant account even after it is disconnected", async () => {
  const connection = account();
  const order = seedPhysicalOrder({ store_id: otherStore, payment_connection_id: connection.id });
  state.sessions.set(order.stripe_session_id, { payment_intent: "pi_merchant" });
  await applyFulfillment(order.id, "needs_ordering", { action: "cancelled", refund: true }, otherStore);
  expect(sessionsRetrieve).toHaveBeenCalledWith(order.stripe_session_id, {}, { stripeAccount: "acct_merchant" });
  expect(refundsCreate).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_merchant" }), { stripeAccount: "acct_merchant", idempotencyKey: `refund-order-${order.id}` });
  expect(order).toMatchObject({ fulfillment_status: "cancelled", refunded_amount: 10795 });
});
it("keeps legacy support credentials and platform CJ credentials away from merchant orders", async () => {
  const order = seedOrder({ store_id: otherStore });
  const legacy = await legacyResend(new Request("https://delivery.example.com/api/admin/resend", { method: "POST", headers: { "x-admin-secret": "a-long-test-admin-secret", "Content-Type": "application/json" }, body: JSON.stringify({ stripe_session_id: order.stripe_session_id }) }));
  expect(legacy.status).toBe(404); expect(sendEmail).not.toHaveBeenCalled();
  ownerMoves();
  expect((await cjFulfillment(post({ action: "sync" }))).status).toBe(503);
});
