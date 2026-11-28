// Short links (supabase/migrations/20261119000000_short_links.sql): readable links like /lamp for
// videos and captions. A visit redirects to the product with UTM tags, logs the click, and leaves a
// first-party cookie so the checkout it leads to (and so the sale) is credited to the link.
import "server-only";
import { getSupabase } from "./supabase";
import { STORE_ID } from "./store-config";
import { HttpError } from "./http";
import { getEnv } from "./env";
import type { CatalogProduct } from "./catalog.types";
import type { ShortLink } from "./database.types";
import { LINK_SOURCES, SLUG_PATTERN, normalizeSlug, slugProblem, type LinkSource } from "./short-link-rules";
export { LINK_SOURCES, SLUG_PATTERN, normalizeSlug, slugProblem, suggestSlugs, type LinkSource } from "./short-link-rules";
export type { ShortLink } from "./database.types";

export const LINK_COOKIE = "pod_link";
export const LINK_COOKIE_DAYS = 30;
/** The public form of a link: the short-link domain when one is set up, otherwise the store's own. */
export function shortLinkBase() {
  const configured = process.env.SHORT_LINK_BASE_URL?.trim();
  const base = configured && /^https:\/\/[a-z0-9.-]+$/i.test(configured.replace(/\/$/, "")) ? configured.replace(/\/$/, "") : getEnv().APP_URL.replace(/\/$/, "");
  return base;
}

export async function listShortLinks(storeId = STORE_ID): Promise<ShortLink[]> {
  const { data, error } = await getSupabase().from("short_links").select("*").eq("store_id", storeId).order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error("Could not load short links");
  return (data ?? []) as ShortLink[];
}

export async function findActiveLink(slug: string): Promise<ShortLink | null> {
  const { data, error } = await getSupabase().from("short_links").select("*").eq("slug", slug).eq("active", true).maybeSingle();
  if (error) throw new Error("Could not load the short link");
  return (data as ShortLink | null) ?? null;
}

function linkInput(body: Record<string, unknown>) {
  const slug = typeof body.slug === "string" ? normalizeSlug(body.slug) : "";
  const problem = slugProblem(slug);
  if (problem) throw new HttpError(400, problem);
  const source = LINK_SOURCES.includes(body.source as LinkSource) ? body.source as LinkSource : "tiktok";
  const label = typeof body.label === "string" ? body.label.replace(/\s+/g, " ").trim().slice(0, 80) || null : null;
  const productId = typeof body.productId === "string" && body.productId && body.productId !== "home" ? body.productId.slice(0, 80) : null;
  return { slug, source, label, product_id: productId };
}

async function assertProduct(productId: string | null, storeId: string) {
  if (!productId) return;
  const { data, error } = await getSupabase().from("products").select("id").eq("store_id", storeId).eq("id", productId).maybeSingle();
  if (error) throw new Error("Could not check the product");
  if (!data) throw new HttpError(400, "Choose one of your products.");
}

export async function createShortLink(body: Record<string, unknown>, storeId = STORE_ID) {
  const input = linkInput(body);
  await assertProduct(input.product_id, storeId);
  const { data, error } = await getSupabase().from("short_links").insert({ ...input, store_id: storeId }).select("*").single();
  if (error?.code === "23505") throw new HttpError(409, `/${input.slug} is already taken. Try another.`);
  if (error || !data) throw new Error("Could not create the short link");
  return data as ShortLink;
}

export async function updateShortLink(body: Record<string, unknown>, storeId = STORE_ID) {
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) throw new HttpError(400, "Choose a link.");
  const changes: Partial<ShortLink> = { updated_at: new Date().toISOString() };
  if (typeof body.active === "boolean") changes.active = body.active;
  if ("productId" in body || "label" in body || "source" in body || "slug" in body) {
    const { data: current, error: readError } = await getSupabase().from("short_links").select("*").eq("store_id", storeId).eq("id", id).maybeSingle();
    if (readError) throw new Error("Could not load the short link");
    if (!current) throw new HttpError(404, "That link no longer exists.");
    const input = linkInput({ slug: current.slug, productId: current.product_id ?? "home", source: current.source, label: current.label, ...body });
    await assertProduct(input.product_id, storeId);
    Object.assign(changes, input);
  }
  const { data, error } = await getSupabase().from("short_links").update(changes).eq("store_id", storeId).eq("id", id).select("*").maybeSingle();
  if (error?.code === "23505") throw new HttpError(409, "That link is already taken. Try another.");
  if (error) throw new Error("Could not update the short link");
  if (!data) throw new HttpError(404, "That link no longer exists.");
  return data as ShortLink;
}

export async function deleteShortLink(body: Record<string, unknown>, storeId = STORE_ID) {
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id) throw new HttpError(400, "Choose a link.");
  const { error } = await getSupabase().from("short_links").delete().eq("store_id", storeId).eq("id", id);
  if (error) throw new Error("Could not delete the short link");
  return { deleted: id };
}

/** Where a link sends people: its product's page (if still listed) or the home page, with UTM tags. */
export function destinationFor(link: Pick<ShortLink, "slug" | "source" | "label">, product: Pick<CatalogProduct, "kind" | "slug" | "status"> | null) {
  const path = product && product.status === "published" ? `/${product.kind === "physical" ? "s" : "p"}/${encodeURIComponent(product.slug)}` : "/";
  const params = new URLSearchParams({ utm_source: link.source, utm_medium: link.source === "other" ? "referral" : "social", utm_campaign: "short-link", utm_content: link.slug });
  return `${path}?${params}`;
}

/** Coarse, cookie-free context for a click: country from the edge, device and in-app browser from the user agent. */
export function clickContext(headers: Headers) {
  const agent = headers.get("user-agent") ?? "";
  const country = (headers.get("x-vercel-ip-country") ?? "").toUpperCase();
  const device = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(agent) ? "tablet" : /Mobi|iPhone|Android/i.test(agent) ? "mobile" : "desktop";
  const inApp = /musical_ly|BytedanceWebview|TikTok/i.test(agent) ? "tiktok" : /Instagram/i.test(agent) ? "instagram" : /FBAN|FBAV|FB_IAB/i.test(agent) ? "facebook" : null;
  // Link previews and crawlers shouldn't count as people.
  const bot = !agent || /bot|crawl|spider|preview|facebookexternalhit|slurp|headless|curl|wget|python|httpclient/i.test(agent);
  return { country: /^[A-Z]{2}$/.test(country) ? country : null, device, inApp, bot } as const;
}

export async function recordClick(linkId: string, context: ReturnType<typeof clickContext>) {
  const { error } = await getSupabase().rpc("record_short_link_click", { p_link_id: linkId, p_country: context.country, p_device: context.device, p_in_app: context.inApp });
  if (error) console.error("Short link click not recorded", error.message?.slice(0, 200) ?? "");
}

/** The link a visitor arrived through, from the cookie set on redirect, for tagging their checkout. */
export function linkFromCookie(header: string | null) {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${LINK_COOKIE}=([a-z0-9-]{2,32})(?:;|$)`));
  return match && SLUG_PATTERN.test(match[1]) ? match[1] : null;
}

export type LinkStats = { orders: number; revenue: number; currency: string | null; clicks7d: number };

/** Orders and revenue credited to each link (via the checkouts it tagged), and clicks in the last week. */
export async function linkStats(links: ShortLink[], storeId = STORE_ID): Promise<Map<string, LinkStats>> {
  const stats = new Map<string, LinkStats>(links.map((link) => [link.slug, { orders: 0, revenue: 0, currency: null, clicks7d: 0 }]));
  if (!links.length) return stats;
  if (links.some(link => link.store_id !== storeId)) throw new HttpError(403, "These links belong to another workspace.");
  const db = getSupabase();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [checkouts, clicks] = await Promise.all([
    db.from("checkouts").select("link_slug, stripe_session_id").eq("store_id", storeId).not("link_slug", "is", null).not("stripe_session_id", "is", null).order("created_at", { ascending: false }).limit(5000),
    db.from("short_link_clicks").select("link_id").in("link_id", links.map((link) => link.id)).gte("created_at", since).limit(20000),
  ]);
  if (checkouts.error || clicks.error) throw new Error("Could not load short link results");
  const bySlug = new Map(links.map((link) => [link.id, link.slug]));
  for (const click of (clicks.data ?? []) as { link_id: string }[]) { const entry = stats.get(bySlug.get(click.link_id) ?? ""); if (entry) entry.clicks7d += 1; }
  const sessionToSlug = new Map(((checkouts.data ?? []) as { link_slug: string; stripe_session_id: string }[]).map((row) => [row.stripe_session_id, row.link_slug]));
  const sessions = [...sessionToSlug.keys()];
  for (let start = 0; start < sessions.length; start += 200) {
    const { data, error } = await db.from("orders").select("stripe_session_id, amount_total, currency").eq("store_id", storeId).in("stripe_session_id", sessions.slice(start, start + 200));
    if (error) throw new Error("Could not load short link sales");
    for (const order of (data ?? []) as { stripe_session_id: string; amount_total: number | null; currency: string | null }[]) {
      const entry = stats.get(sessionToSlug.get(order.stripe_session_id) ?? "");
      if (!entry) continue;
      entry.orders += 1;
      if (!entry.currency || entry.currency === order.currency) { entry.currency = order.currency; entry.revenue += order.amount_total ?? 0; }
    }
  }
  return stats;
}
