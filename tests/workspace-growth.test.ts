import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, seedProduct, state, couponsCreate, promotionCodesUpdate } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { createDiscountCode, listDiscountCodes, setDiscountCodeActive } from "../lib/discount-codes";
import { createShortLink, updateShortLink, deleteShortLink, listShortLinks, linkStats } from "../lib/short-links";
import { currentGift, listSubscribers, setGift } from "../lib/subscribers";
import { listReviews, setReviewStatus } from "../lib/reviews";
import { setThankYouCode } from "../lib/thank-you-offers";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined }) }));
import { GET as subscriberExport } from "../app/api/admin/subscribers/export/route";
import { POST as giftAction } from "../app/api/admin/subscribers/route";
import { POST as reviewAction } from "../app/api/admin/reviews/route";
import { POST as linkAction } from "../app/api/admin/links/route";
import { POST as discountAction } from "../app/api/admin/discounts/route";
const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
beforeEach(() => {
  resetFakes(); jar.clear();
  state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: randomUUID(), name: "Other store" });
});
function ownerMoves() { state.stores[0].owner_user_id = null; state.stores[1].owner_user_id = OWNER_ID; jar.set("veilcode_owner", "owner-token"); }
const post = (body: unknown) => new Request("https://delivery.example.com/api/admin/action", { method: "POST", headers: { origin: "https://delivery.example.com", "Content-Type": "application/json" }, body: JSON.stringify(body) });
function connected() {
  const now = new Date().toISOString();
  state.payment_connections.push({ id: randomUUID(), store_id: otherStore, provider: "stripe", external_account_id: "acct_merchant", livemode: false, is_current: true, status: "connected", charges_enabled: true, payouts_enabled: true, country: "GB", requirements: [], created_at: now, updated_at: now });
}
it("creates merchant discount codes in its account and refuses foreign toggles and thank-you selections", async () => {
  const original = await createDiscountCode({ code: "WELCOME", value: 10 });
  connected(); ownerMoves();
  const response = await discountAction(post({ action: "create", storeId: STORE_ID, code: "WELCOME", value: 15 }));
  expect(response.status).toBe(200);
  expect(couponsCreate).toHaveBeenLastCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ store_id: otherStore }) }), { stripeAccount: "acct_merchant" });
  const codes = await listDiscountCodes(otherStore); expect(codes).toHaveLength(1); expect(codes[0].percent_off).toBe(15);
  await expect(setDiscountCodeActive({ id: original.id, active: false }, otherStore)).rejects.toMatchObject({ status: 404 });
  await expect(setThankYouCode(original.id, otherStore)).rejects.toMatchObject({ status: 400 });
  expect(promotionCodesUpdate).not.toHaveBeenCalled();
});
it("refuses to create discounts for an unconnected merchant or toggle a code missing its merchant account", async () => {
  await expect(createDiscountCode({ code: "NEWSTORE", value: 10 }, otherStore)).rejects.toMatchObject({ status: 503 });
  expect(couponsCreate).not.toHaveBeenCalled();
  const code = await createDiscountCode({ code: "LEGACY", value: 10 });
  state.discount_codes[0].store_id = otherStore;
  await expect(setDiscountCodeActive({ id: code.id, active: false }, otherStore)).rejects.toMatchObject({ status: 409 });
  expect(promotionCodesUpdate).not.toHaveBeenCalled();
});
it("keeps link products, edits, deletions and statistics inside the workspace", async () => {
  const original = seedProduct(); const own = seedProduct({ store_id: otherStore });
  const foreign = await createShortLink({ slug: "first", productId: original.id });
  await expect(createShortLink({ slug: "wrong", productId: original.id }, otherStore)).rejects.toMatchObject({ status: 400 });
  const ownLink = await createShortLink({ slug: "second", productId: own.id }, otherStore);
  await expect(updateShortLink({ id: foreign.id, active: false }, otherStore)).rejects.toMatchObject({ status: 404 });
  await deleteShortLink({ id: foreign.id }, otherStore);
  expect((await listShortLinks()).map(l => l.id)).toEqual([foreign.id]);
  expect((await listShortLinks(otherStore)).map(l => l.id)).toEqual([ownLink.id]);
  await expect(linkStats([foreign], otherStore)).rejects.toMatchObject({ status: 403 });
});
it("derives link-creation scope from database ownership", async () => {
  ownerMoves(); const own = seedProduct({ store_id: otherStore });
  expect((await linkAction(post({ action: "create", slug: "merchant", productId: own.id, storeId: STORE_ID }))).status).toBe(200);
  expect(state.short_links[0].store_id).toBe(otherStore);
});
it("selects gifts only from the owned catalog and keeps the other store's gift unchanged", async () => {
  const original = seedProduct(); const own = seedProduct({ store_id: otherStore });
  await setGift(original.id);
  ownerMoves();
  expect((await giftAction(post({ action: "gift", productId: original.id, storeId: STORE_ID }))).status).toBe(400);
  expect((await giftAction(post({ action: "gift", productId: own.id, storeId: STORE_ID }))).status).toBe(200);
  expect((await currentGift())?.id).toBe(original.id); expect((await currentGift(otherStore))?.id).toBe(own.id);
});
it("lists and exports only subscribers in the owned workspace", async () => {
  const now = new Date().toISOString();
  state.subscribers.push({ id: randomUUID(), store_id: STORE_ID, email: "original@example.com", marketing_consent: true, created_at: now }, { id: randomUUID(), store_id: otherStore, email: "merchant@example.com", marketing_consent: false, created_at: now });
  expect((await listSubscribers(otherStore)).summary).toMatchObject({ total: 1, consented: 0 });
  ownerMoves(); const response = await subscriberExport(); const csv = await response.text();
  expect(response.status).toBe(200); expect(csv).toContain("merchant@example.com"); expect(csv).not.toContain("original@example.com");
});
it("cannot moderate a foreign review through its ID or a supplied store ID", async () => {
  const foreign = { id: randomUUID(), store_id: STORE_ID, status: "pending" };
  const own = { id: randomUUID(), store_id: otherStore, status: "pending" };
  state.reviews.push(foreign, own); ownerMoves();
  await expect(setReviewStatus({ id: foreign.id, status: "approved" }, otherStore)).rejects.toMatchObject({ status: 404 });
  expect((await reviewAction(post({ action: "status", id: own.id, status: "approved", storeId: STORE_ID }))).status).toBe(200);
  expect(foreign.status).toBe("pending"); expect(own.status).toBe("approved");
  expect((await listReviews(otherStore)).map(r => r.id)).toEqual([own.id]);
});
