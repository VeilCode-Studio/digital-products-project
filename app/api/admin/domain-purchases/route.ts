import { requireWorkspace } from "@/lib/workspace";
import { apiError, HttpError, jsonObject, sameOrigin } from "@/lib/http";
import { domainPurchaseContext } from "@/lib/domain-purchase-mode";
import { startDomainPurchase } from "@/lib/domain-purchase-checkout";
import { domainPurchaseStatus } from "@/lib/domain-purchase-status";
import { ownedDomainPurchase } from "@/lib/domain-purchase-journal";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (data: unknown) => Response.json(data, { headers: { "Cache-Control": "no-store" } });
export async function GET(req: Request) {
  try {
    const { ownerId, storeId } = await requireWorkspace();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "Choose a domain purchase.");
    return json(await domainPurchaseStatus(id, domainPurchaseContext(ownerId, storeId)));
  } catch (error) { return apiError(error); }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { ownerId, storeId } = await requireWorkspace();
    const context = domainPurchaseContext(ownerId, storeId);
    const body = await jsonObject(req, 8000);
    if (body.action === "reconcile" && typeof body.id === "string") return json(await domainPurchaseStatus(body.id, context, true));
    if (body.action === "resume_checkout" && typeof body.id === "string") {
      const row = await ownedDomainPurchase(body.id, context);
      if (!row) throw new HttpError(404, "Domain purchase not found.");
      if (row.status !== "checkout_pending" || !row.contact) throw new HttpError(409, "This purchase is no longer awaiting checkout. Check its status.");
      return json(await startDomainPurchase({ requestId: row.id, productId: row.product_id, hostname: row.hostname,
        expectedPrice: row.amount / 100, expectedRenewalPrice: row.renewal_amount / 100, expectedYears: row.years,
        renew: row.auto_renew, contact: row.contact, simulationScenario: row.simulation_scenario, acceptTerms: true }, context));
    }
    return json(await startDomainPurchase(body, context));
  } catch (error) { return apiError(error); }
}
