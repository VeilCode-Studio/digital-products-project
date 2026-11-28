import { requireWorkspace } from "@/lib/workspace";
import { recentOrders } from "@/lib/dashboard";
import { apiError } from "@/lib/http";
import { csvCell } from "@/lib/csv";

export const runtime = "nodejs";
export async function GET() {
  try {
    const { storeId } = await requireWorkspace();
    const orders = await recentOrders(5000, storeId);
    const rows = [["Session", "Email", "Product", "Amount (minor units)", "Currency", "Email status", "Fulfilment", "Purchased at"],
      ...orders.map((order) => [order.stripe_session_id, order.email,
        order.physical_snapshot?.items[0]?.name ?? order.product_snapshot?.name ?? order.product_id,
        order.amount_total, order.currency, order.email_status, order.fulfillment_status ?? "", order.created_at])];
    return new Response("\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="podstore-latest-5000-orders.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return apiError(error); }
}
