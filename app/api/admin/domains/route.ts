import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { connectDomain, checkDomain, removeDomain, searchDomain, rehearsePurchase, domainServiceState } from "@/lib/domain-provider";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    await requireWorkspace();
    return Response.json(await domainServiceState(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { storeId } = await requireWorkspace();
    const body = await jsonObject(req, 4_000);
    let result: object;
    switch (body.action) {
      case "connect": result = { domain: await connectDomain(body.productId, body.hostname, storeId) }; break;
      case "check": result = { domain: await checkDomain(body.id, storeId) }; break;
      case "remove": await removeDomain(body.id, storeId); result = {}; break;
      case "search": result = { quotes: await searchDomain(body.hostname) }; break;
      case "rehearse": result = await rehearsePurchase(body.hostname, body.expectedPrice); break;
      default: throw new HttpError(400, "Unknown domain action.");
    }
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
