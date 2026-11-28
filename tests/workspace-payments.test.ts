import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, state, oauthToken, oauthDeauthorize, rpc, accountsRetrieve } from "./fakes";
import { startStripeConnection, completeStripeConnection, disconnectStripe, CONNECT_COOKIE } from "../lib/stripe-connect";
import { STORE_ID } from "../lib/store-config";
import { getStore } from "../lib/catalog";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined, set: (key: string, value: string) => jar.set(key, value) }) }));
import { POST as paymentAction } from "../app/api/admin/payments/stripe/[action]/route";
import { GET as callback } from "../app/api/admin/payments/stripe/callback/route";
import { POST as settings } from "../app/api/admin/settings/route";
const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
const otherOwner = "223b175d-2a62-4af7-9bcc-6747c9f29d42";
beforeEach(() => {
  resetFakes(); jar.clear(); vi.stubEnv("STRIPE_CONNECT_ENABLED", "true");
  state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: otherOwner, name: "Other store" });
});
function ownerMoves() {
  state.stores[0].owner_user_id = null; state.stores[1].owner_user_id = OWNER_ID;
  jar.set("veilcode_owner", "owner-token");
}
it("links only the explicitly owned store and cannot consume another workspace's OAuth state", async () => {
  const start = await startStripeConnection(otherOwner, otherStore);
  expect(state.payment_oauth_attempts[0]).toMatchObject({ store_id: otherStore, owner_user_id: otherOwner });
  const params = new URLSearchParams({ state: start.state, code: "ac_test" });
  await expect(completeStripeConnection(OWNER_ID, params, start.state)).rejects.toMatchObject({ status: 400 });
  expect(oauthToken).not.toHaveBeenCalled(); expect(state.payment_oauth_attempts[0].consumed_at).toBeNull();
  expect(await completeStripeConnection(otherOwner, params, start.state, otherStore)).toBe("connected");
  expect(rpc).toHaveBeenCalledWith("activate_payment_connection", expect.objectContaining({ p_store_id: otherStore, p_owner_id: otherOwner }));
  expect(state.payment_connections[0].store_id).toBe(otherStore);
});
it("denies a non-owner before OAuth state creation or account deauthorization", async () => {
  await expect(startStripeConnection(OWNER_ID, otherStore)).rejects.toMatchObject({ status: 403 });
  await expect(disconnectStripe(OWNER_ID, otherStore)).rejects.toMatchObject({ status: 403 });
  expect(state.payment_oauth_attempts).toEqual([]); expect(oauthDeauthorize).not.toHaveBeenCalled();
});
it("starts and completes OAuth through the database-owned workspace after a redirect", async () => {
  ownerMoves();
  const start = await paymentAction(new Request("https://delivery.example.com/api/admin/payments/stripe/start?storeId=" + STORE_ID, { method: "POST", headers: { origin: "https://delivery.example.com" } }), { params: Promise.resolve({ action: "start" }) });
  expect(start.status).toBe(200); expect(state.payment_oauth_attempts[0].store_id).toBe(otherStore);
  const nonce = jar.get(CONNECT_COOKIE)!;
  const result = await callback(new Request(`https://delivery.example.com/api/admin/payments/stripe/callback?state=${nonce}&code=ac_test&storeId=${STORE_ID}`));
  expect(result.headers.get("location")).toBe("https://delivery.example.com/admin/settings?payment=connected");
  expect(state.payment_connections[0].store_id).toBe(otherStore);
});
it("disconnects only the current account in its workspace", async () => {
  const now = new Date().toISOString();
  for (const [store, account] of [[STORE_ID, "acct_original"], [otherStore, "acct_merchant"]]) state.payment_connections.push({ id: randomUUID(), store_id: store, provider: "stripe", external_account_id: account, livemode: false, is_current: true, status: "connected", charges_enabled: true, payouts_enabled: true, country: "GB", requirements: [], created_at: now, updated_at: now });
  await disconnectStripe(otherOwner, otherStore);
  expect(oauthDeauthorize).toHaveBeenCalledWith({ client_id: "ca_testApplication", stripe_user_id: "acct_merchant" }, { maxNetworkRetries: 0 });
  expect(state.payment_connections.map(c => c.status)).toEqual(["connected", "disconnected"]);
  expect(accountsRetrieve).not.toHaveBeenCalled();
});
it("reads and updates only the verified workspace's settings", async () => {
  ownerMoves();
  const original = structuredClone(state.stores[0]);
  expect((await getStore(otherStore)).name).toBe("Other store");
  const result = await settings(new Request("https://delivery.example.com/api/admin/settings", { method: "POST", headers: { origin: "https://delivery.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ storeId: STORE_ID, name: "Merchant brand", tagline: "My products", bio: "Welcome", support_email: "support@example.com", website_url: "https://example.com" }) }));
  expect(result.status).toBe(200); expect(state.stores[1].name).toBe("Merchant brand");
  expect(state.stores[0]).toEqual(original);
});
