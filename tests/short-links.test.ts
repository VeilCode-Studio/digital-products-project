import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedProduct, state } from "./fakes";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));
// Outside a real request, run `after` work straight away so its effects can be checked.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (task: () => unknown) => { void task(); } }));

import { GET as linkRoute } from "../app/[link]/route";
import { POST as linksApi } from "../app/api/admin/links/route";
import { POST as checkoutRoute } from "../app/api/checkout/route";
import { destinationFor, linkFromCookie, linkStats, normalizeSlug, slugProblem, suggestSlugs, clickContext } from "../lib/short-links";
import type { ShortLink } from "../lib/database.types";

const ORIGIN = "https://delivery.example.com";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_33.1.0";
const visit = (slug: string, agent = PHONE) => linkRoute(new Request(`${ORIGIN}/${slug}`, { headers: { "user-agent": agent, "x-vercel-ip-country": "us" } }), { params: Promise.resolve({ link: slug }) });
const api = (body: unknown) => linksApi(new Request(`${ORIGIN}/api/admin/links`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }));
function seedLink(overrides: Partial<ShortLink> = {}) {
  const link = { id: randomUUID(), store_id: state.stores[0]?.id ?? "c9fdc8a4-3d95-4d43-97f2-b650386179d2", slug: "lamp", product_id: null, source: "tiktok", label: null, active: true, clicks: 0, last_clicked_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...overrides };
  state.short_links.push(link);
  return link as ShortLink;
}

beforeEach(() => { resetFakes(); jar.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("slug rules", () => {
  it("turns names into typeable slugs", () => {
    expect(normalizeSlug("  Mira Desk Lamp!! ")).toBe("mira-desk-lamp");
    expect(normalizeSlug("Café Crème")).toBe("cafe-creme");
    expect(slugProblem("lamp")).toBeNull();
    expect(slugProblem("a")).toMatch(/at least 2/);
    expect(slugProblem("admin")).toMatch(/already used by the site/);
    expect(slugProblem("Lamp")).toMatch(/lowercase/);
  });
  it("suggests short words first, skipping ones already taken", () => {
    expect(suggestSlugs("The Mira Desk Lamp")).toEqual(["mira", "miradesk", "mira-desk"]);
    expect(suggestSlugs("Mira", new Set(["mira"]))).toEqual(["mira2", "mira3", "mira4"]);
  });
  it("reads the link cookie safely", () => {
    expect(linkFromCookie("a=1; pod_link=lamp; b=2")).toBe("lamp");
    expect(linkFromCookie("pod_link=<script>")).toBeNull();
    expect(linkFromCookie(null)).toBeNull();
  });
  it("tags the destination and falls back home when the product isn't live", () => {
    const link = { slug: "lamp", source: "tiktok", label: null } as const;
    expect(destinationFor(link, { kind: "physical", slug: "mira", status: "published" })).toBe("/s/mira?utm_source=tiktok&utm_medium=social&utm_campaign=short-link&utm_content=lamp");
    expect(destinationFor(link, { kind: "physical", slug: "mira", status: "draft" })).toMatch(/^\/\?utm_source=tiktok/);
    expect(destinationFor(link, null)).toMatch(/^\/\?/);
  });
  it("tells people from bots and in-app browsers", () => {
    expect(clickContext(new Headers({ "user-agent": PHONE, "x-vercel-ip-country": "us" }))).toEqual({ country: "US", device: "mobile", inApp: "tiktok", bot: false });
    expect(clickContext(new Headers({ "user-agent": "facebookexternalhit/1.1" })).bot).toBe(true);
  });
});

describe("visiting a short link", () => {
  it("redirects to the product, sets the link cookie and counts the click", async () => {
    const product = seedProduct({ kind: "physical", slug: "mira", status: "published" });
    const link = seedLink({ product_id: product.id });
    const response = await visit("Lamp");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/s/mira?utm_source=tiktok&utm_medium=social&utm_campaign=short-link&utm_content=lamp`);
    expect(response.headers.get("set-cookie")).toMatch(/pod_link=lamp;.*HttpOnly/i);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await vi.waitFor(() => expect(state.short_link_clicks).toHaveLength(1));
    expect(state.short_link_clicks[0]).toMatchObject({ link_id: link.id, country: "US", device: "mobile", in_app: "tiktok" });
    expect(state.short_links[0].clicks).toBe(1);
  });
  it("sends unknown and paused links home, and doesn't count bots", async () => {
    seedLink({ slug: "paused", active: false });
    seedLink({ slug: "live" });
    for (const slug of ["nothing-here", "paused"]) {
      const response = await visit(slug);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/`);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    await visit("live", "facebookexternalhit/1.1");
    expect(state.short_link_clicks).toHaveLength(0);
  });
  it("gives files and odd paths a plain 404", async () => {
    expect((await visit("apple-touch-icon.png")).status).toBe(404);
    expect((await visit("a".repeat(40))).status).toBe(404);
  });
});

describe("managing links", () => {
  it("creates a link for the owner and refuses duplicates and reserved words", async () => {
    jar.set("veilcode_owner", "owner-token");
    const product = seedProduct();
    const response = await api({ action: "create", slug: "Kick Off", productId: product.id, source: "tiktok", label: "Video 1" });
    expect(response.status).toBe(200);
    expect(state.short_links[0]).toMatchObject({ slug: "kick-off", product_id: product.id, label: "Video 1" });
    expect((await api({ action: "create", slug: "kick-off", productId: "home" })).status).toBe(409);
    expect((await api({ action: "create", slug: "admin", productId: "home" })).status).toBe(400);
    expect((await api({ action: "create", slug: "ok", productId: "not-a-product" })).status).toBe(400);
  });
  it("pauses, re-points and deletes", async () => {
    jar.set("veilcode_owner", "owner-token");
    const product = seedProduct();
    const link = seedLink();
    expect((await api({ action: "update", id: link.id, active: false })).status).toBe(200);
    expect(state.short_links[0].active).toBe(false);
    expect((await api({ action: "update", id: link.id, productId: product.id })).status).toBe(200);
    expect(state.short_links[0]).toMatchObject({ product_id: product.id, slug: "lamp" });
    expect((await api({ action: "delete", id: link.id })).status).toBe(200);
    expect(state.short_links).toHaveLength(0);
  });
  it("needs the owner", async () => {
    expect((await api({ action: "create", slug: "lamp", productId: "home" })).status).toBe(401);
  });
});

describe("crediting sales", () => {
  it("tags the checkout started after a link visit, and counts its order", async () => {
    const product = seedProduct();
    const link = seedLink({ product_id: product.id });
    const checkoutId = randomUUID();
    const response = await checkoutRoute(new Request(`${ORIGIN}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN, cookie: "pod_link=lamp" }, body: JSON.stringify({ productId: product.id, checkoutId }) }));
    expect(response.status).toBe(200);
    expect(state.checkouts[0].link_slug).toBe("lamp");
    state.checkouts[0].stripe_session_id = "cs_link";
    state.orders.push({ stripe_session_id: "cs_link", store_id: state.checkouts[0].store_id, amount_total: 2900, currency: "usd" } as never);
    const stats = await linkStats([link]);
    expect(stats.get("lamp")).toMatchObject({ orders: 1, revenue: 2900, currency: "usd" });
  });
  it("leaves checkouts without a link untouched", async () => {
    const product = seedProduct();
    await checkoutRoute(new Request(`${ORIGIN}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify({ productId: product.id, checkoutId: randomUUID() }) }));
    expect(state.checkouts[0]).not.toHaveProperty("link_slug");
  });
});
