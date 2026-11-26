import type { NextRequest } from "next/server";
import { renewOwnerSession } from "@/lib/owner-session";
import { NextResponse } from "next/server";
import { domainProduct, domainsEnabled, publicProductUrl } from "@/lib/domains";
import { domainPath, storefrontPath } from "@/lib/domain-rules";
import { getEnv } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";
import { STORE_ID } from "@/lib/store-config";

/** Keeps the owner signed in: renews the hour-long session before it runs out. Pages still check access themselves. */
export async function proxy(request: NextRequest) {
  if (domainsEnabled()) {
    const host = request.nextUrl.hostname;
    const platform = new URL(getEnv().APP_URL).hostname;
    const deploymentHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL];
    if (host !== platform && !deploymentHosts.includes(host)) {
      try {
        const product = await domainProduct(host);
        if (!product) return new NextResponse("Store not found", { status: 404 });
        const path = request.nextUrl.pathname;
        if (path.startsWith("/admin")) return NextResponse.redirect(new URL("/admin", getEnv().APP_URL));
        const base = storefrontPath(product);
        // Related products belong to their own platform/custom address.
        if (/^\/(p|s)\/[a-z0-9-]+(?:\/|$)/.test(path) && path !== base && !path.startsWith(`${base}/`)) {
          const target = new URL(path + request.nextUrl.search, getEnv().APP_URL);
          return NextResponse.redirect(target);
        }
        const destination = domainPath(path, product);
        if (!destination) return new NextResponse("Page not found", { status: 404 });
        // Remove the internal product prefix from links in the existing storefront components.
        if (path === base || path.startsWith(`${base}/`)) {
          const url = request.nextUrl.clone(); url.pathname = path.slice(base.length) || "/";
          return NextResponse.redirect(url, 308);
        }
        if (destination !== path) {
          const url = request.nextUrl.clone(); url.pathname = destination;
          return NextResponse.rewrite(url);
        }
        return NextResponse.next();
      } catch {
        return new NextResponse("Store temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
    // Old platform product links resolve to the primary domain. Draft previews always stay here.
    const match = /^\/(s|p)\/([a-z0-9-]+)$/.exec(request.nextUrl.pathname);
    if (match && !request.nextUrl.searchParams.has("preview")) {
      const { data } = await getSupabase().from("products").select("*").eq("store_id", STORE_ID).eq("slug", match[2]).eq("status", "published").maybeSingle();
      if (data && (data.kind === "physical" ? "s" : "p") === match[1]) {
        const target = new URL(await publicProductUrl(data));
        if (target.hostname !== platform) { target.search = request.nextUrl.search; return NextResponse.redirect(target, 307); }
      }
    }
  }
  return request.cookies.has("veilcode_owner_refresh") ? renewOwnerSession(request) : NextResponse.next();
}

export const config = {
  matcher: [{
    source: "/((?!_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png).*)",
  }],
};
