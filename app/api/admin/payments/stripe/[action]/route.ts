import { cookies } from "next/headers";
import { requireWorkspace } from "@/lib/workspace";
import { apiError, sameOrigin, HttpError } from "@/lib/http";
import { getEnv } from "@/lib/env";
import { connectEnabled, currentStripeConnection, refreshConnection } from "@/lib/payment-connections";
import { CONNECT_COOKIE, disconnectStripe, startStripeConnection } from "@/lib/stripe-connect";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    sameOrigin(req);
    const { ownerId, storeId } = await requireWorkspace();
    if (!connectEnabled()) throw new HttpError(503, "Stripe connections are not enabled yet.");
    const { action } = await params;
    if (action === "start") {
      const { state, url } = await startStripeConnection(ownerId, storeId);
      (await cookies()).set(CONNECT_COOKIE, state, { httpOnly: true, secure: getEnv().APP_URL.startsWith("https:"), sameSite: "lax", path: "/api/admin/payments/stripe", maxAge: 600 });
      return Response.json({ url }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "disconnect") await disconnectStripe(ownerId, storeId);
    else if (action === "refresh") {
      const connection = await currentStripeConnection(storeId);
      if (connection) await refreshConnection(connection);
    } else throw new HttpError(404, "Payment action not found.");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
