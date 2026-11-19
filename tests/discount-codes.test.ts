import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { couponsCreate, promotionCodesCreate, promotionCodesUpdate, resetFakes, seedProduct, sessionsCreate, state } from "./fakes";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST as discountsApi } from "../app/api/admin/discounts/route";
import { POST as checkoutRoute } from "../app/api/checkout/route";
import { codeUsable, discountFromSession, listDiscountCodes, normalizeCode } from "../lib/discount-codes";
import { insertOrder } from "../lib/orders";

const ORIGIN = "https://delivery.example.com";
const api = (body: unknown) => discountsApi(new Request(`${ORIGIN}/api/admin/discounts`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }));

beforeEach(() => { resetFakes(); jar.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("discount codes", () => {
  it("normalises what the owner types and knows when a code stops working", () => {
    expect(normalizeCode(" tiktok 10 ")).toBe("TIKTOK10");
    expect(normalizeCode("café_crème--20!")).toBe("CAFECREME-20");
    const live = { active: true, expires_at: null, max_redemptions: 2 };
    expect(codeUsable(live, 1)).toBe(true);
    expect(codeUsable(live, 2)).toBe(false);
    expect(codeUsable({ ...live, expires_at: new Date(Date.now() - 1000).toISOString() }, 0)).toBe(false);
    expect(codeUsable({ ...live, active: false }, 0)).toBe(false);
  });

  it("creates the code in Stripe and remembers it, refusing duplicates and silly values", async () => {
    jar.set("veilcode_owner", "owner-token");
    const response = await api({ action: "create", code: "tiktok10", kind: "percent", value: 10, maxRedemptions: 50, expiresAt: "2099-01-31", label: "Launch video" });
    expect(response.status).toBe(200);
    expect(couponsCreate).toHaveBeenCalledWith(expect.objectContaining({ percent_off: 10, duration: "once" }), {});
    expect(promotionCodesCreate).toHaveBeenCalledWith(expect.objectContaining({ code: "TIKTOK10", max_redemptions: 50, expires_at: Date.parse("2099-01-31T23:59:59Z") / 1000, promotion: expect.objectContaining({ type: "coupon" }) }), {});
    expect(state.discount_codes[0]).toMatchObject({ code: "TIKTOK10", percent_off: 10, label: "Launch video", stripe_account_id: null, livemode: false });

    expect((await api({ action: "create", code: "TikTok10", kind: "percent", value: 15 })).status).toBe(409);
    expect((await api({ action: "create", code: "BIG", kind: "percent", value: 95 })).status).toBe(400);
    expect((await api({ action: "create", code: "x", kind: "percent", value: 10 })).status).toBe(400);
    expect((await api({ action: "create", code: "OLD", kind: "percent", value: 10, expiresAt: "2001-01-01" })).status).toBe(400);
    const fixed = await api({ action: "create", code: "FIVE-OFF", kind: "amount", value: 5, currency: "gbp" });
    expect(fixed.status).toBe(200);
    expect(state.discount_codes[1]).toMatchObject({ code: "FIVE-OFF", amount_off: 500, currency: "gbp", percent_off: null });
  });

  it("pauses a code in Stripe before showing it paused", async () => {
    jar.set("veilcode_owner", "owner-token");
    await api({ action: "create", code: "PAUSEME", kind: "percent", value: 10 });
    const code = state.discount_codes[0];
    expect((await api({ action: "active", id: code.id, active: false })).status).toBe(200);
    expect(promotionCodesUpdate).toHaveBeenCalledWith(code.stripe_promotion_code_id, { active: false }, {});
    expect(state.discount_codes[0].active).toBe(false);
  });

  it("needs the owner", async () => {
    expect((await api({ action: "create", code: "SNEAKY", kind: "percent", value: 50 })).status).toBe(401);
  });

  it("lets shoppers enter codes at checkout and credits paid orders to their code", async () => {
    const product = seedProduct();
    await checkoutRoute(new Request(`${ORIGIN}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify({ productId: product.id, checkoutId: randomUUID() }) }));
    expect(sessionsCreate.mock.calls[0][0]).toMatchObject({ allow_promotion_codes: true });

    jar.set("veilcode_owner", "owner-token");
    await api({ action: "create", code: "TIKTOK10", kind: "percent", value: 10 });
    const promotionId = state.discount_codes[0].stripe_promotion_code_id as string;
    const discount = await discountFromSession({ discounts: [{ coupon: null, promotion_code: promotionId }], total_details: { amount_discount: 290 } } as never);
    expect(discount).toEqual({ discountCode: "TIKTOK10", discountAmount: 290 });
    expect(await discountFromSession({ discounts: [], total_details: { amount_discount: 0 } } as never)).toEqual({ discountCode: null, discountAmount: null });

    await insertOrder({ sessionId: "cs_code", productId: product.id, email: "a@example.com", amountTotal: 2610, currency: "usd", tokenHash: "h1", expiresAt: new Date(Date.now() + 86400_000).toISOString(), ...discount });
    expect(state.orders[0]).toMatchObject({ discount_code: "TIKTOK10", discount_amount: 290 });
    const [row] = await listDiscountCodes();
    expect(row.stats).toMatchObject({ orders: 1, revenue: 2610, discounted: 290, currency: "usd" });
  });
});
