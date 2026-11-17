import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedPhysicalStore, state } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { metaPixelLoader } from "../lib/tiktok-pixel";
import { parseBrand } from "../lib/store-themes";
import { buildPolicy, parseStorePolicies } from "../lib/store-policies";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST as physicalRoute } from "../app/api/checkout/physical/route";
import { POST as webhookRoute } from "../app/api/stripe-webhook/route";

const META = "1234567890123456";
const TIKTOK = "C4ABCD1234EFGH5678IJ";
const BLACK = "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b01";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function checkoutRequest(checkoutId: string, headers: Record<string, string> = {}) {
  return new Request("https://delivery.example.com/api/checkout/physical", {
    method: "POST",
    headers: {
      "Content-Type": "application/json", origin: "https://delivery.example.com", referer: "https://delivery.example.com/s/glow?fbclid=abc",
      cookie: "_fbc=fb.1.1700000000000.abc; _fbp=fb.1.1700000000000.123456; _ttp=2abcTTPcookie", "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0 Test",
      ...headers,
    },
    body: JSON.stringify({ productId: "glow-lamp", variantId: BLACK, quantity: 2, checkoutId }),
  });
}
function paidEvent(checkoutId: string) {
  const checkout = state.checkouts.find((row) => row.id === checkoutId)!;
  return new Request("https://delivery.example.com/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": "sig" }, body: JSON.stringify({ id: "evt_meta", livemode: false, type: "checkout.session.completed", data: { object: {
    id: checkout.stripe_session_id, client_reference_id: checkout.id, payment_status: "paid", mode: "payment", currency: "usd",
    amount_subtotal: checkout.amount, amount_total: checkout.amount, shipping_cost: { amount_total: 0, shipping_rate: null },
    customer_details: { email: " Buyer@Example.com ", name: "Ada Lovelace", phone: "(555) 555-0100" },
    collected_information: { shipping_details: { name: "Ada Lovelace", address: { line1: "1 Main St", line2: null, city: "Austin", state: "TX", postal_code: "73301", country: "US" } } },
    metadata: { app: "veilcode-store", kind: "physical", checkout_id: checkout.id, product_id: "glow-lamp", store_id: STORE_ID },
  } } }) });
}

let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  resetFakes();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("META_ACCESS_TOKENS", `${META}=meta-secret-token`);
  vi.stubEnv("TIKTOK_ACCESS_TOKENS", `${TIKTOK}=tt-secret-token`);
  fetcher = vi.fn(async (url: string) => url.includes("graph.facebook.com")
    ? Response.json({ events_received: 1, fbtrace_id: "x" })
    : Response.json({ code: 0, message: "OK" }));
  vi.stubGlobal("fetch", fetcher);
});

describe("Meta pixel", () => {
  it("accepts a numeric pixel id and refuses anything else", () => {
    expect(parseBrand({ metaPixelId: " 1234 5678 9012 3456 " }, STORE_ID, "glow-lamp").metaPixelId).toBe(META);
    expect(() => parseBrand({ metaPixelId: "abc\"></script>" }, STORE_ID, "glow-lamp")).toThrow("Meta pixel ID");
  });

  it("sends the purchase to the Conversions API with the pixel's event id, alongside TikTok, then forgets the attribution", async () => {
    seedPhysicalStore({ brand: { name: "Lumora Co.", supportEmail: "help@lumora.example", tiktokPixelId: TIKTOK, metaPixelId: META } });
    const checkoutId = randomUUID();
    expect((await physicalRoute(checkoutRequest(checkoutId))).status).toBe(200);
    expect(state.checkouts[0].attribution).toMatchObject({ fbc: "fb.1.1700000000000.abc", fbp: "fb.1.1700000000000.123456" });

    expect((await webhookRoute(paidEvent(checkoutId))).status).toBe(200);
    const metaCall = fetcher.mock.calls.find(([url]) => String(url).includes("graph.facebook.com")) as [string, RequestInit];
    expect(metaCall[0]).toBe(`https://graph.facebook.com/v24.0/${META}/events`);
    expect((metaCall[1].headers as Record<string, string>).Authorization).toBe("Bearer meta-secret-token");
    const body = JSON.parse(metaCall[1].body as string);
    expect(body).not.toHaveProperty("test_event_code");
    expect(body.data[0]).toMatchObject({
      event_name: "Purchase", event_id: checkoutId, action_source: "website",
      user_data: { em: [sha("buyer@example.com")], ph: [sha("15555550100")], fbc: "fb.1.1700000000000.abc", fbp: "fb.1.1700000000000.123456", client_ip_address: "203.0.113.7", client_user_agent: "Mozilla/5.0 Test" },
      custom_data: { currency: "USD", value: 98, content_ids: ["glow-lamp"], contents: [{ id: "glow-lamp", quantity: 2, item_price: 49 }] },
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("tiktok.com"))).toBe(true);
    expect(state.checkouts[0].attribution).toBeNull();
  });

  it("keeps attribution for a Meta-only store, and still records the order when Meta is down", async () => {
    seedPhysicalStore({ brand: { name: "Lumora Co.", supportEmail: "help@lumora.example", metaPixelId: META } });
    fetcher.mockResolvedValueOnce(Response.json({ error: { code: 190 } }, { status: 400 }));
    const checkoutId = randomUUID();
    await physicalRoute(checkoutRequest(checkoutId));
    expect(state.checkouts[0].attribution).not.toBeNull();
    fetcher.mockImplementation(async () => Response.json({ error: { code: 190 } }, { status: 400 }));
    expect((await webhookRoute(paidEvent(checkoutId))).status).toBe(200);
    expect(state.orders).toHaveLength(1);
  });

  it("collects nothing from shoppers who opted out", async () => {
    seedPhysicalStore({ brand: { name: "Lumora Co.", supportEmail: "help@lumora.example", metaPixelId: META } });
    const checkoutId = randomUUID();
    await physicalRoute(checkoutRequest(checkoutId, { "sec-gpc": "1" }));
    expect(state.checkouts[0].attribution).toBeNull();
    await webhookRoute(paidEvent(checkoutId));
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("graph.facebook.com"))).toBe(false);
  });

  it("loads only for shoppers who haven't opted out, and the policy names each platform", () => {
    const loader = metaPixelLoader(META);
    expect(loader).toContain(`fbq("init","${META}")`);
    expect(loader).toContain("navigator.globalPrivacyControl===true");
    const policies = parseStorePolicies({
      version: 1, sellerName: "Lumora Co. Ltd", sellerAddress: "", processingDays: { min: 1, max: 3 }, returnWindowDays: 30, returnShippingPaidBy: "customer",
      refundDays: 5, lostParcelDays: 14, responseTime: "", governingLaw: "England and Wales", extra: {}, updatedAt: "2026-11-13",
    });
    const text = buildPolicy("privacy", { brand: "Lumora", productName: "Glow Lamp", supportEmail: null, currency: "usd", rates: [], policies, adPlatforms: ["TikTok", "Meta"] })
      .sections.flatMap((section) => section.paragraphs).join("\n");
    expect(text).toContain("TikTok and Meta pixels on this store record");
    expect(text).toContain("Meta (Facebook and Instagram)");
    expect(text).toContain("TikTok and Meta pixels' cookies");
  });
});
