import { requireWorkspace } from "@/lib/workspace";
import { STORE_ID } from "@/lib/store-config";
import { sameOrigin, apiError, HttpError, jsonObject } from "@/lib/http";
import { placeCjOrder, planCjOrder, syncCjOrders } from "@/lib/cj-orders";
import { connectCjUpdates } from "@/lib/cj-webhooks";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orderId = (value: unknown) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, "Invalid order.");
  return value;
};

/** Ordering from CJ: plan (prices, stock, shipping; places nothing), place, and sync tracking. */
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    if (storeId !== STORE_ID) throw new HttpError(503, "CJ fulfilment is not configured for this workspace. Use manual fulfilment.");
    const body = await jsonObject(req);
    let result: unknown;
    switch (body.action) {
      case "plan": result = { plan: await planCjOrder(orderId(body.orderId)) }; break;
      case "place": {
        const placed = await placeCjOrder(orderId(body.orderId), body.logisticName);
        result = { ok: true, cjOrderId: placed.cjOrderId, cost: placed.cost, sandbox: placed.sandbox, message: placed.message };
        break;
      }
      case "sync": result = await syncCjOrders(30, 45_000); break;
      case "connect-updates": result = await connectCjUpdates(); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
