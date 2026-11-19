import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedOrder, seedProduct, sessionsCreate, state } from "./fakes";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST as discountsApi } from "../app/api/admin/discounts/route";
import { POST as checkoutRoute } from "../app/api/checkout/route";
import { digitalOffers, thankYouCode } from "../lib/thank-you-offers";

const ORIGIN = "https://delivery.example.com";
const api = (body: unknown) => discountsApi(new Request(`${ORIGIN}/api/admin/discounts`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }));

beforeEach(() => { resetFakes(); jar.clear(); jar.set("veilcode_owner", "owner-token"); });

describe("thank-you add-ons", () => {
  it("shows the chosen code only while Stripe would still accept it", async () => {
    expect(await thankYouCode()).toBeNull();
    await api({ action: "create", code: "THANKS15", kind: "percent", value: 15, maxRedemptions: 1 });
    const code = state.discount_codes[0];
    expect((await api({ action: "thank-you", id: code.id })).status).toBe(200);
    expect(await thankYouCode()).toEqual({ code: "THANKS15", description: "15% off", endsAt: null });

    seedOrder({ discount_code: "THANKS15", stripe_session_id: "cs_used" });
    expect(await thankYouCode()).toBeNull();
    expect((await api({ action: "thank-you", id: "not-a-code" })).status).toBe(400);
    expect((await api({ action: "thank-you", id: null })).status).toBe(200);
  });

  it("suggests what pairs with the purchase, never the product just bought", async () => {
    const pair = seedProduct({ slug: "pair", name: "Pair" });
    const other = seedProduct({ slug: "other", name: "Other", sort_order: 5 });
    seedProduct({ slug: "draft", status: "draft" });
    const bought = seedProduct({ slug: "bought", related_ids: [pair.id] });
    const checkoutId = randomUUID();
    await checkoutRoute(new Request(`${ORIGIN}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify({ productId: bought.id, checkoutId }) }));
    expect(sessionsCreate.mock.calls[0][0]).toMatchObject({ success_url: `${ORIGIN}/thank-you?ref=${checkoutId}` });

    const offers = await digitalOffers(checkoutId);
    expect(offers.products.map((product) => product.slug)).toEqual(["pair", "other"]);
    expect(offers.products.some((product) => product.id === bought.id)).toBe(false);
    expect(other.id).toBeTruthy();
    expect((await digitalOffers("nonsense")).products).toEqual([]);
  });
});
