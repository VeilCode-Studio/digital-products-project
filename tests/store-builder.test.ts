import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHYSICAL_PREFIX, resetFakes, seedPhysicalStore, sessionsCreate, state, storageCopy, storageList } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { discountedUnit, offerFor, parseStorePage } from "../lib/store-page";
import { reviewSummary } from "../components/storefront/sections";
import { listAbandoned } from "../lib/abandoned";
import { duplicateStore, saveStorePreview } from "../lib/manage-stores";
import { getStorefront } from "../lib/storefront";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST as physicalRoute } from "../app/api/checkout/physical/route";
import { POST as webhookRoute } from "../app/api/stripe-webhook/route";

const BLACK = "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b01";
const IMAGE = { path: `${PHYSICAL_PREFIX}media/a.webp`, kind: "image", alt: "Lamp", poster: null };
const heroWith = (data: Record<string, unknown>) => ({ id: "hero", type: "hero", enabled: true, data: { headline: "Glow", media: [IMAGE], ...data } });
const page = (...sections: Record<string, unknown>[]) => ({ version: 1, sections });

beforeEach(() => {
  resetFakes(); jar.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function checkoutRequest(checkoutId: string, quantity: number) {
  return new Request("https://delivery.example.com/api/checkout/physical", {
    method: "POST", headers: { "Content-Type": "application/json", origin: "https://delivery.example.com" },
    body: JSON.stringify({ productId: "glow-lamp", variantId: BLACK, quantity, checkoutId }),
  });
}
function stripeEvent(type: string, object: Record<string, unknown>) {
  return new Request("https://delivery.example.com/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: JSON.stringify({ id: `evt_${randomUUID()}`, livemode: false, type, data: { object } }) });
}

describe("customer reviews", () => {
  it("keeps genuine review fields, rating 1 to 5, and averages them", () => {
    const parsed = parseStorePage(page(heroWith({}), { id: "reviews", type: "reviews", data: { title: "Loved", items: [
      { name: "Maya R.", location: "Austin, TX", rating: 5, title: "Great", text: "Bedtime is fun again." },
      { name: "Sam", rating: "4", text: "Bright and calm." },
    ] } }), STORE_ID, "glow-lamp");
    const reviews = parsed.sections[1];
    expect(reviews.type === "reviews" && reviews.data.items).toEqual([
      { name: "Maya R.", location: "Austin, TX", rating: 5, title: "Great", text: "Bedtime is fun again.", media: null },
      { name: "Sam", location: "", rating: 4, title: "", text: "Bright and calm.", media: null },
    ]);
    expect(reviewSummary([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual({ count: 3, average: 4.3 });
    const bad = (item: Record<string, unknown>) => () => parseStorePage(page(heroWith({}), { id: "reviews", type: "reviews", data: { items: [item] } }), STORE_ID, "glow-lamp");
    expect(bad({ name: "A", rating: 6, text: "x" })).toThrow("whole number from 1 to 5");
    expect(bad({ name: "A", rating: 5, text: "" })).toThrow("text: is required");
    expect(bad({ name: "A", rating: 5, text: "x", media: { ...IMAGE, path: `${STORE_ID}/other/media/a.webp` } })).toThrow("not a file from this store");
  });
});

describe("quantity offers", () => {
  it("allows up to three rising tiers and picks the best one a quantity reaches", () => {
    const offers = [{ quantity: 2, percentOff: 10, label: "Popular" }, { quantity: 3, percentOff: 15 }];
    const parsed = parseStorePage(page(heroWith({ offers })), STORE_ID, "glow-lamp").sections[0];
    const tiers = parsed.type === "hero" ? parsed.data.offers : [];
    expect(tiers).toEqual([{ quantity: 2, percentOff: 10, label: "Popular" }, { quantity: 3, percentOff: 15, label: "" }]);
    expect(offerFor(tiers, 1)).toBeNull();
    expect(offerFor(tiers, 2)?.percentOff).toBe(10);
    expect(offerFor(tiers, 7)?.percentOff).toBe(15);
    expect(discountedUnit(4900, offerFor(tiers, 3))).toBe(4165);
    expect(() => parseStorePage(page(heroWith({ offers: [{ quantity: 3, percentOff: 10 }, { quantity: 2, percentOff: 20 }] })), STORE_ID, "glow-lamp")).toThrow("bigger discount");
    expect(() => parseStorePage(page(heroWith({ offers: [{ quantity: 2, percentOff: 80 }] })), STORE_ID, "glow-lamp")).toThrow("from 1 to 50");
  });

  it("charges the discounted price at checkout, decided on the server", async () => {
    seedPhysicalStore({ page: page(heroWith({ offers: [{ quantity: 2, percentOff: 10 }] })) });
    expect((await physicalRoute(checkoutRequest(randomUUID(), 2))).status).toBe(200);
    expect(state.checkouts[0]).toMatchObject({ amount: 8820 });
    expect(state.checkouts[0].physical_snapshot!.items[0]).toMatchObject({ unitAmount: 4410, listUnitAmount: 4900, percentOff: 10, quantity: 2 });
    const session = sessionsCreate.mock.calls[0][0];
    expect(session.line_items[0]).toMatchObject({ quantity: 2, price_data: { unit_amount: 4410 } });
    expect(session.line_items[0].price_data.product_data.description).toContain("10% off each");

    // One item pays full price.
    expect((await physicalRoute(checkoutRequest(randomUUID(), 1))).status).toBe(200);
    expect(state.checkouts[1]).toMatchObject({ amount: 4900 });
  });
});

describe("abandoned checkouts", () => {
  it("asks Stripe for a recovery link and promotional consent", async () => {
    seedPhysicalStore();
    await physicalRoute(checkoutRequest(randomUUID(), 1));
    expect(sessionsCreate.mock.calls[0][0]).toMatchObject({ after_expiration: { recovery: { enabled: true } }, consent_collection: { promotions: "auto" } });
  });

  it("records an expired cart with its recovery link, keeping the email only with consent", async () => {
    seedPhysicalStore();
    const [withConsent, without] = [randomUUID(), randomUUID()];
    await physicalRoute(checkoutRequest(withConsent, 1));
    await physicalRoute(checkoutRequest(without, 2));
    const expired = (checkoutId: string, consent: string | null) => {
      const checkout = state.checkouts.find((row) => row.id === checkoutId)!;
      return stripeEvent("checkout.session.expired", {
        id: checkout.stripe_session_id, payment_status: "unpaid", expires_at: Math.floor(Date.now() / 1000), consent: consent ? { promotions: consent } : null,
        customer_details: { email: "Shopper@Example.com" }, after_expiration: { recovery: { url: "https://buy.stripe.com/r/live_abc" } },
        metadata: { app: "veilcode-store", kind: "physical", checkout_id: checkoutId, product_id: "glow-lamp", store_id: STORE_ID },
      });
    };
    expect((await webhookRoute(expired(withConsent, "opt_in"))).status).toBe(200);
    expect((await webhookRoute(expired(without, "opt_out"))).status).toBe(200);
    const list = await listAbandoned();
    expect(list).toHaveLength(2);
    expect(list.find((entry) => entry.id === withConsent)).toMatchObject({ email: "shopper@example.com", recoveryUrl: "https://buy.stripe.com/r/live_abc", product: "Glow Lamp", amount: 4900 });
    expect(list.find((entry) => entry.id === without)).toMatchObject({ email: null, quantity: 2 });
  });

  it("turns a payment through the recovery link into the order, and drops it from the list", async () => {
    seedPhysicalStore();
    const checkoutId = randomUUID();
    await physicalRoute(checkoutRequest(checkoutId, 1));
    const original = state.checkouts[0].stripe_session_id;
    await webhookRoute(stripeEvent("checkout.session.expired", {
      id: original, payment_status: "unpaid", consent: null, after_expiration: { recovery: { url: "https://buy.stripe.com/r/x" } },
      metadata: { app: "veilcode-store", kind: "physical", checkout_id: checkoutId, product_id: "glow-lamp", store_id: STORE_ID },
    }));
    // The recovered session carries none of our references, only what it recovered.
    const paid = stripeEvent("checkout.session.completed", {
      id: "cs_test_recovered", recovered_from: original, payment_status: "paid", mode: "payment", currency: "usd", client_reference_id: null, metadata: {},
      amount_subtotal: 4900, amount_total: 4900, shipping_cost: { amount_total: 0, shipping_rate: null },
      customer_details: { email: "buyer@example.com", name: "Ada Lovelace", phone: null },
      collected_information: { shipping_details: { name: "Ada Lovelace", address: { line1: "1 Main St", line2: null, city: "Austin", state: "TX", postal_code: "73301", country: "US" } } },
    });
    expect((await webhookRoute(paid)).status).toBe(200);
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0]).toMatchObject({ stripe_session_id: "cs_test_recovered", kind: "physical" });
    expect(state.checkouts[0]).toMatchObject({ stripe_session_id: "cs_test_recovered" });
    expect(state.checkouts[0].recovered_at).toBeTruthy();
    expect(await listAbandoned()).toEqual([]);
    // A session claiming to recover a different amount is not adopted.
    const forged = stripeEvent("checkout.session.completed", { id: "cs_forged", recovered_from: "cs_test_recovered", payment_status: "paid", mode: "payment", currency: "usd", amount_subtotal: 1, metadata: {}, customer_details: { email: "x@example.com" } });
    await webhookRoute(forged);
    expect(state.orders).toHaveLength(1);
  });
});

describe("duplicating a store", () => {
  it("copies the page, variants and media into a new draft with its own folder and URL", async () => {
    seedPhysicalStore({ status: "published", brand: { name: "Lumora Co.", supportEmail: "help@lumora.example", logoPath: `${PHYSICAL_PREFIX}brand/logo.png` } });
    storageList.mockResolvedValueOnce({ data: [{ id: "1", name: "a.webp" }, { id: "2", name: "clip.mp4" }], error: null });
    const { id, slug } = await duplicateStore({ id: "glow-lamp" });
    expect(slug).toBe("glow-copy");
    const copy = state.products.find((row) => row.id === id)!;
    expect(copy).toMatchObject({ status: "draft", kind: "physical", name: "Glow Lamp (copy)", shipping_profile_id: "profile-1" });
    expect(JSON.stringify(copy.page)).toContain(`${STORE_ID}/${id}/media/a.webp`);
    expect(JSON.stringify(copy.page)).not.toContain(PHYSICAL_PREFIX);
    expect((copy.brand as { logoPath: string }).logoPath).toBe(`${STORE_ID}/${id}/brand/logo.png`);
    const variants = state.product_variants.filter((row) => row.product_id === id);
    expect(variants.map((row) => [row.options.Color, row.price_amount, row.image_path])).toEqual([["Black", 4900, `${STORE_ID}/${id}/media/black.webp`], ["White", 5400, `${STORE_ID}/${id}/media/white.webp`]]);
    expect(variants.every((row) => row.id !== BLACK)).toBe(true);
    const copied = storageCopy.mock.calls.map(([from, to]) => [from, to]);
    expect(copied).toContainEqual([`${PHYSICAL_PREFIX}media/clip.mp4`, `${STORE_ID}/${id}/media/clip.mp4`]);
    expect(copied).toContainEqual([`${PHYSICAL_PREFIX}brand/logo.png`, `${STORE_ID}/${id}/brand/logo.png`]);
    expect((await duplicateStore({ id: "glow-lamp" })).slug).toBe("glow-copy-2");
  });
});

describe("live preview of unsaved changes", () => {
  it("shows the owner the validated draft, and never anyone else or the plain preview", async () => {
    seedPhysicalStore({ status: "published" });
    await saveStorePreview({
      id: "glow-lamp", name: "Glow Lamp Pro", tagline: "Brighter", theme: "clean-minimal",
      brand: { name: "Lumora Co.", supportEmail: "help@lumora.example" }, page: page(heroWith({ headline: "New headline" })),
      variants: [{ id: BLACK, options: { Color: "Black" }, sku: null, price_amount: 3900, compare_at_amount: null, image_path: null, active: true, supplier_url: null, supplier_sku: null }],
    });
    expect(state.products[0].name).toBe("Glow Lamp");
    jar.set("veilcode_owner", "owner-token");
    const draft = await getStorefront("glow", { preview: true, unsaved: true });
    expect(draft).toMatchObject({ product: { name: "Glow Lamp Pro", draft: true }, theme: "clean-minimal" });
    expect(draft!.variants).toEqual([expect.objectContaining({ price: 3900 })]);
    expect((await getStorefront("glow", { preview: true }))!.product.name).toBe("Glow Lamp");
    jar.clear();
    expect((await getStorefront("glow", { preview: true, unsaved: true }))!.product.name).toBe("Glow Lamp");
    await expect(saveStorePreview({ id: "glow-lamp", name: "x", theme: "clean-minimal", brand: {}, page: page(heroWith({ media: [{ ...IMAGE, path: "../../etc" }] })), variants: [] })).rejects.toThrow();
  });
});
