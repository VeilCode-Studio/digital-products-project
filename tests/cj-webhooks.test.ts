import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedPhysicalOrder, seedPhysicalStore, sendEmail, state } from "./fakes";
import type { CjOrderState, CjVariantPrice } from "../lib/cj";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));
const later = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[] }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => { later.tasks.push(task()); },
}));
const cj = vi.hoisted(() => ({
  prices: new Map<string, CjVariantPrice[] | null>(), details: new Map<string, CjOrderState | null>(),
  webhookUrl: null as string | null, subscribed: [] as string[], images: [] as string[], balance: 0,
}));
vi.mock("../lib/cj", async (original) => ({
  ...(await original<typeof import("../lib/cj")>()),
  cjConfigured: () => true,
  cjVariantPrices: async (pid: string) => cj.prices.has(pid) ? cj.prices.get(pid)! : null,
  cjOrderDetail: async (id: string) => cj.details.get(id) ?? null,
  cjSetWebhooks: async (url: string) => { cj.webhookUrl = url; },
  cjSubscribeProducts: async (pids: string[]) => { cj.subscribed = pids; return pids.length; },
  cjProductImages: async () => cj.images,
  cjBalance: async () => cj.balance,
  cjSubscribedProducts: async () => cj.subscribed.length,
}));

import { POST as webhook } from "../app/api/webhooks/cj/[key]/route";
import { POST as cjAdmin } from "../app/api/admin/fulfillment/cj/route";
import { POST as mediaApi } from "../app/api/admin/stores/media/route";
import { handleCjNotification, notificationIds, webhookKey } from "../lib/cj-webhooks";
import { liveChecks } from "../lib/go-live";

const ORIGIN = "https://delivery.example.com";
const BLACK = "0b5e3c3e-6f4a-4f63-9a3c-1f0d3a1e2b01";
const admin = (url: string, handler: (req: Request) => Promise<Response>, body: Record<string, unknown>) =>
  handler(new Request(`${ORIGIN}${url}`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }));
const notify = (key: string, body: unknown) => webhook(
  new Request(`${ORIGIN}/api/webhooks/cj/${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ key }) } as RouteContext<"/api/webhooks/cj/[key]">,
);

function linked() {
  seedPhysicalStore();
  state.product_variants[0].supplier_url = "https://cjdropshipping.com/product/lamp-p-PID1.html";
  state.product_variants[0].supplier_sku = "VID-B";
  state.product_variants[0].unit_cost = 900;
}

beforeEach(() => {
  resetFakes(); jar.clear(); jar.set("veilcode_owner", "owner-token");
  vi.stubEnv("CJ_API_KEY", "CJ123@api@key");
  cj.prices.clear(); cj.details.clear(); later.tasks = [];
  Object.assign(cj, { webhookUrl: null, subscribed: [], images: [], balance: 0 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("CJ notifications", () => {
  it("only answers at the secret address, and answers CJ's test call at once", async () => {
    const key = webhookKey()!;
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await notify("wrong-key-wrong-key-wrong-key-xx", {})).status).toBe(404);
    expect((await notify(key, { test: true })).status).toBe(200);
    vi.stubEnv("CJ_API_KEY", "another-key");
    expect((await notify(key, {})).status).toBe(404);
  });

  it("rechecks the order a notification names, from CJ's API, and emails tracking", async () => {
    linked();
    const order = seedPhysicalOrder({ fulfillment_status: "ordered", supplier_order_ref: "CJ2611250000000001" });
    order.physical_snapshot!.items[0].variantId = BLACK;
    cj.details.set("CJ2611250000000001", { status: "SHIPPED", trackNumber: "92001234567890", trackingUrl: null, carrier: "USPS", amount: 2449 });
    // The notification's own claims are ignored: only the ids matter, and CJ's API decides.
    const response = await notify(webhookKey()!, { messageId: "m1", type: "LOGISTIC", params: { orderId: "CJ2611250000000001", trackingStatus: "DELIVERED", trackNumber: "FAKE" } });
    expect(response.status).toBe(200);
    await Promise.all(later.tasks);
    expect(state.orders[0]).toMatchObject({ fulfillment_status: "shipped", tracking_number: "92001234567890" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("rechecks stock for the product or variant a notification names", async () => {
    linked();
    cj.prices.set("PID1", [{ vid: "VID-B", sku: null, cost: 900, stock: 0 }]);
    expect(await handleCjNotification({ type: "STOCK", params: { vid: "VID-B", stock: 999 } })).toMatchObject({ products: { checked: 1, alerts: 1 } });
    expect(state.product_variants[0].supplier_alert).toBe("CJ is out of stock of this variant.");
    expect(await handleCjNotification({ type: "STOCK", params: { vid: "SOMEONE-ELSES" } })).toMatchObject({ products: null });
    expect(notificationIds({ a: [{ b: "PID1" }], c: "has spaces", d: 12345 })).toEqual(["PID1", "12345"]);
  });

  it("connects from the live store only, subscribing every linked product", async () => {
    linked();
    const { status, body } = await (async () => { const r = await admin("/api/admin/fulfillment/cj", cjAdmin, { action: "connect-updates" }); return { status: r.status, body: await r.json() }; })();
    expect(status).toBe(200);
    expect(body).toEqual({ connected: true, products: 1 });
    expect(cj.webhookUrl).toBe(`${ORIGIN}/api/webhooks/cj/${webhookKey()}`);
    expect(cj.subscribed).toEqual(["PID1"]);
    vi.stubEnv("DEPLOYMENT_ENV", "development");
    expect((await admin("/api/admin/fulfillment/cj", cjAdmin, { action: "connect-updates" })).status).not.toBe(200);
  });
});

describe("importing CJ photos", () => {
  it("copies photos from CJ's CDN into the store's media, skipping anything else", async () => {
    linked();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0)]);
    cj.images = ["https://cf.cjdropshipping.com/a.png", "https://cf.cjdropshipping.com/broken.png"];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.endsWith("/a.png")) return new Response(png, { headers: { "content-type": "image/png" } });
      if (input.endsWith("/broken.png")) return new Response("<html>", { headers: { "content-type": "text/html" } });
      throw new Error(`Unexpected ${input}`);
    }));
    const response = await admin("/api/admin/stores/media", mediaApi, { action: "import-cj", productId: state.products[0].id, supplierUrl: "https://cjdropshipping.com/product/lamp-p-PID1.html" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.files).toHaveLength(1);
    expect(body.files[0].path).toMatch(/media\/.+\.png$/);
    expect(body.skipped).toBe(1);
    expect((await admin("/api/admin/stores/media", mediaApi, { action: "import-cj", productId: state.products[0].id, supplierUrl: "https://evil.example/x-p-1.html" })).status).toBe(400);
  });
});

describe("go-live checklist", () => {
  it("reports what the store can check, without secret values", async () => {
    linked();
    state.product_variants[1].supplier_url = "https://cjdropshipping.com/product/lamp-p-PID1.html";
    state.product_variants[1].supplier_sku = null;
    const { checks } = await liveChecks();
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
    expect(byId["cj-key"].status).toBe("done");
    expect(byId.cron.status).toBe("todo");
    expect(byId["cj-balance"]).toMatchObject({ status: "todo", title: "Top up your CJ wallet" });
    expect(byId["cj-updates"]).toMatchObject({ status: "todo", action: "connect-cj" });
    expect(byId["cj-sku"].detail).toMatch(/^1 variant linked to CJ has no supplier SKU/);
    expect(JSON.stringify(checks)).not.toContain("CJ123@api@key");

    vi.stubEnv("CRON_SECRET", "a-long-random-secret");
    cj.balance = 25_000; cj.subscribed = ["PID1"];
    const again = Object.fromEntries((await liveChecks()).checks.map((check) => [check.id, check]));
    expect(again.cron.status).toBe("done");
    expect(again["cj-balance"]).toMatchObject({ status: "done", detail: "$250.00 available." });
    expect(again["cj-updates"].status).toBe("done");
    expect(JSON.stringify(again)).not.toContain("a-long-random-secret");
  });
});
