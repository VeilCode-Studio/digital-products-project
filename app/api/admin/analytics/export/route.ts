import { requireWorkspace } from "@/lib/workspace";
import { apiError } from "@/lib/http";
import { csvCell } from "@/lib/csv";
import { parseFilters } from "@/lib/analytics";
import { loadAnalytics } from "@/lib/analytics-data";

export const runtime = "nodejs";
/** The analytics report as a spreadsheet: the trend, then the top products, for the same filters. */
export async function GET(req: Request) {
  try {
    const { storeId } = await requireWorkspace();
    const filters = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
    const data = await loadAnalytics(filters, storeId);
    const major = (amount: number) => (amount / 100).toFixed(2);
    const rows: (string | number)[][] = [
      [`PodStore analytics ${filters.from} to ${filters.to}`, `Type: ${filters.kind}`, `Currency: ${data.currency.toUpperCase()}`], [],
      [`Period (${data.granularity})`, "Revenue", "Orders", "Previous revenue", "Previous orders"],
      ...data.trend.map((point) => [point.key, major(point.revenue), point.orders, major(point.previousRevenue), point.previousOrders]), [],
      ["Product", "Type", "Orders", "Items", "Revenue", "Share"],
      ...data.products.map((product) => [product.name, product.kind, product.orders, product.units, major(product.revenue), `${(product.share * 100).toFixed(1)}%`]),
    ];
    return new Response("﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="podstore-analytics-${filters.from}-to-${filters.to}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return apiError(error); }
}
