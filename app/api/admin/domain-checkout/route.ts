import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { apiError, jsonObject, sameOrigin } from "@/lib/http";
import { getEnv } from "@/lib/env";
import { domainCheckoutCookie, domainTestPayment, startDomainTestCheckout } from "@/lib/domain-checkout";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const owner = await requireOwner();
    const result = await startDomainTestCheckout(await jsonObject(req, 2_000), owner.id);
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    // A locator for Stripe's cancel return, not proof of payment or authorization. Each tab has its own request ID.
    response.cookies.set(domainCheckoutCookie(result.requestId), result.sessionId, {
      httpOnly: true, secure: new URL(getEnv().APP_URL).protocol === "https:", sameSite: "lax", path: "/admin/domains", maxAge: 86400,
    });
    return response;
  } catch (error) { return apiError(error); }
}

export async function GET(req: Request) {
  try {
    const owner = await requireOwner();
    return Response.json(await domainTestPayment(new URL(req.url).searchParams.get("session"), owner.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
