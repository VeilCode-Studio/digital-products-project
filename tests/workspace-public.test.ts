import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { OWNER_ID, resetFakes, seedProduct, state, sessionsCreate, sendEmail, signUrl } from "./fakes";
import { productPath } from "../lib/storefront-paths";
import { getDigitalPage, resolveDeliveryProduct } from "../lib/catalog";
import { startCheckout } from "../lib/checkout";
import { domainProduct, publicProductUrl } from "../lib/domains";
import { proxy } from "../proxy";
import { createPersonalToken, revokeConnection, listConnections } from "../lib/mcp/oauth";
import { recentActivity } from "../lib/mcp/activity";
import { POST as mcp } from "../app/api/mcp/route";
import { POST as webhook } from "../app/api/stripe-connect-webhook/route";
import { GET as download } from "../app/api/download/route";
import { createResearch, listResearch, updateResearch } from "../lib/research";
import { createDigitalDraft } from "../lib/mcp/digital";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined }) }));
const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
beforeEach(() => { resetFakes(); jar.clear(); state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: randomUUID(), name: "Merchant brand", support_email: "merchant@example.com" }); vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "true"); });
function merchantProduct() {
  const id = randomUUID();
  return seedProduct({ id, store_id: otherStore, slug: "shared-name", stripe_product_id: null, stripe_price_id: null, storage_path: `${otherStore}/${id}/downloads/guide.pdf` });
}
function connected() {
  const now = new Date().toISOString();
  state.payment_connections.push({ id: randomUUID(), store_id: otherStore, provider: "stripe", external_account_id: "acct_merchant", livemode: false, is_current: true, status: "connected", charges_enabled: true, payouts_enabled: true, country: "GB", requirements: [], created_at: now, updated_at: now });
}
async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await mcp(new Request("https://delivery.example.com/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
  return (await response.json()).result;
}
it("separates duplicate public slugs and denies draft previews to the other owner", async () => {
  const original = seedProduct({ slug: "shared-name" }); const own = merchantProduct();
  expect((await getDigitalPage("shared-name", false))?.id).toBe(original.id);
  expect((await getDigitalPage("shared-name", false, otherStore))?.id).toBe(own.id);
  expect(productPath(own)).toBe(`/shops/${otherStore}/p/shared-name`);
  own.status = "draft"; jar.set("veilcode_owner", "owner-token");
  expect(await getDigitalPage("shared-name", true, otherStore)).toBeNull();
  state.stores[0].owner_user_id = null; state.stores[1].owner_user_id = OWNER_ID;
  expect((await getDigitalPage("shared-name", true, otherStore))?.id).toBe(own.id);
});
it("resolves a custom domain through its own store and rewrites to the tenant product URL", async () => {
  seedProduct({ slug: "shared-name" }); const own = merchantProduct();
  state.store_domains.push({ id: randomUUID(), store_id: otherStore, product_id: own.id, hostname: "merchantbrand.com", status: "active", verification: [], checked_at: null, created_at: new Date().toISOString() });
  expect((await domainProduct("merchantbrand.com"))?.id).toBe(own.id);
  expect(await publicProductUrl(own)).toBe("https://merchantbrand.com/");
  const result = await proxy(new NextRequest("https://merchantbrand.com/"));
  expect(result.headers.get("x-middleware-rewrite")).toBe(`https://merchantbrand.com/shops/${otherStore}/p/shared-name`);
  expect((await proxy(new NextRequest("https://merchantbrand.com/admin"))).headers.get("location")).toBe("https://delivery.example.com/admin");
});
it("charges and fulfills a merchant product in its connected account and emails its own download", async () => {
  const own = merchantProduct(); connected();
  await startCheckout(own.id, randomUUID());
  const checkout = state.checkouts[0];
  expect(checkout.store_id).toBe(otherStore);
  expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({ success_url: expect.stringContaining(`/shops/${otherStore}/thank-you`), metadata: expect.objectContaining({ store_id: otherStore }) }), expect.objectContaining({ stripeAccount: "acct_merchant" }));
  const event = { type: "checkout.session.completed", account: "acct_merchant", livemode: false, data: { object: { id: checkout.stripe_session_id, mode: "payment", payment_status: "paid", client_reference_id: checkout.id, currency: checkout.currency, amount_subtotal: checkout.amount, amount_total: checkout.amount, customer_details: { email: "buyer@example.com" }, metadata: { app: "veilcode-store", checkout_id: checkout.id, store_id: otherStore, product_id: own.id } } } };
  expect((await webhook(new Request("https://delivery.example.com/api/stripe-connect-webhook", { method: "POST", headers: { "stripe-signature": "test" }, body: JSON.stringify(event) }))).status).toBe(200);
  expect(state.orders[0].store_id).toBe(otherStore); expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ from: "Merchant brand <orders@mail.veilcode.studio>", replyTo: "merchant@example.com" }), expect.anything());
  const url = /https:\/\/delivery.example.com\/api\/download\?token=[A-Za-z0-9_-]+/.exec(sendEmail.mock.calls[0][0].text)![0];
  expect((await download(new Request(url))).status).toBe(302);
  expect(signUrl).toHaveBeenCalledWith(own.storage_path, 60, expect.anything());
});
it("does not use a foreign download path or fall back to a legacy product", async () => {
  const original = seedProduct({ id: "lead-to-kickoff" });
  expect(await resolveDeliveryProduct(original.id, { name: "Foreign", shortName: "Foreign", emailSubject: "", storagePath: original.storage_path!, downloadFilename: "guide.pdf", templatesUrl: null }, otherStore)).toBeUndefined();
  expect(await resolveDeliveryProduct(original.id, null, otherStore)).toBeUndefined();
});
it("keeps research edits and assistant-created digital drafts in the caller's store", async () => {
  const original = await createResearch({ title: "Original idea" });
  await expect(updateResearch({ id: original.id, title: "Stolen" }, otherStore)).rejects.toMatchObject({ status: 404 });
  await createResearch({ title: "Merchant idea" }, otherStore);
  expect((await listResearch(otherStore)).map(i => i.title)).toEqual(["Merchant idea"]);
  const draft = await createDigitalDraft({ name: "Merchant draft", slug: "merchant", price: 1900 }, undefined, otherStore);
  expect(state.products.find(p => p.id === draft.id)?.store_id).toBe(otherStore);
  expect(draft.previewUrl).toBe(`/shops/${otherStore}/p/merchant`);
});
it("binds assistant tools, revocation, and activity to their connection's workspace", async () => {
  const original = seedProduct(); const own = merchantProduct();
  const first = await createPersonalToken("First assistant", ["read", "build"]);
  const second = await createPersonalToken("Merchant assistant", ["read", "build"], otherStore);
  const products = await call(second.token, "list_products");
  expect(products.structuredContent.products.map((p: { id: string }) => p.id)).toEqual([own.id]);
  expect((await call(second.token, "get_digital_product", { product_id: original.id })).isError).toBe(true);
  expect((await listConnections(otherStore)).map(c => c.id)).toEqual([second.connection.id]);
  await expect(revokeConnection(first.connection.id, otherStore)).rejects.toMatchObject({ status: 404 });
  expect((await recentActivity(60, otherStore)).every(a => a.connection_id === second.connection.id)).toBe(true);
});
