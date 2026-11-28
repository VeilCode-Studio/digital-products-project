import { requireWorkspace } from "@/lib/workspace";
import { sameOrigin, apiError, HttpError, jsonObject } from "@/lib/http";
import { applyFulfillment, FULFILLMENT_STATUSES, parseFulfillmentAction } from "@/lib/fulfillment";
import type { FulfillmentStatus } from "@/lib/database.types";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req);
    if (typeof body.orderId !== "string" || !UUID.test(body.orderId) ||
        !FULFILLMENT_STATUSES.includes(body.expected as FulfillmentStatus)) throw new HttpError(400, "Invalid order.");
    const order = await applyFulfillment(body.orderId, body.expected as FulfillmentStatus, parseFulfillmentAction(body), storeId);
    return Response.json({ ok: true, status: order.fulfillment_status, trackingEmailSent: !!order.tracking_email_sent_at }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
