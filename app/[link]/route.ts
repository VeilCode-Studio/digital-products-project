import { after, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getCatalogProduct } from "@/lib/catalog";
import { clickContext, destinationFor, findActiveLink, LINK_COOKIE, LINK_COOKIE_DAYS, recordClick, SLUG_PATTERN } from "@/lib/short-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/**
 * Short links (lib/short-links.ts): /lamp sends the visitor to its product with UTM tags. Every other
 * top-level route is matched before this one, so only unclaimed single words reach here. A word that
 * isn't a link goes to the home page, which is kinder than a 404 for someone typing from a video.
 */
export async function GET(req: Request, { params }: { params: Promise<{ link: string }> }) {
  const app = new URL(getEnv().APP_URL);
  const slug = decodeURIComponent((await params).link).trim().toLowerCase();
  // Files and odd paths (favicon requests, scanners) get a plain 404 rather than a redirect.
  if (slug.length > 32 || !SLUG_PATTERN.test(slug)) return new Response("Not found", { status: 404, headers });

  // A separate short domain hands over to the store's own, so the link cookie lands where checkout reads it.
  const host = new URL(req.url).host;
  if (host !== app.host && process.env.SHORT_LINK_BASE_URL && new URL(process.env.SHORT_LINK_BASE_URL).host === host) {
    return NextResponse.redirect(new URL(`/${slug}`, app), { status: 307, headers });
  }

  let link = null;
  try { link = await findActiveLink(slug); } catch (error) { console.error("Short link lookup failed", error instanceof Error ? error.message.slice(0, 200) : ""); }
  if (!link) return NextResponse.redirect(new URL("/", app), { status: 307, headers });

  let product = null;
  try { product = link.product_id ? await getCatalogProduct(link.product_id, link.store_id) : null; } catch { /* send them home rather than fail */ }
  const response = NextResponse.redirect(new URL(destinationFor(link, product), app), { status: 307, headers });
  response.cookies.set(LINK_COOKIE, link.slug, { httpOnly: true, secure: app.protocol === "https:", sameSite: "lax", path: "/", maxAge: LINK_COOKIE_DAYS * 86_400 });

  const context = clickContext(req.headers);
  if (!context.bot) after(() => recordClick(link.id, context));
  return response;
}
