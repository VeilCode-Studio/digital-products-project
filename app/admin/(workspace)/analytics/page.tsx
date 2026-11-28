import { workspaceForUser } from "@/lib/workspace";
import { Download } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { listProducts } from "@/lib/catalog";
import { parseFilters } from "@/lib/analytics";
import { loadAnalytics } from "@/lib/analytics-data";
import { NavSection } from "@/components/admin-nav";
import { AnalyticsFrame } from "@/components/analytics/analytics-filters";
import { AnalyticsReport } from "@/components/analytics/analytics-report";

export const dynamic = "force-dynamic";
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const filters = parseFilters(await searchParams);
  const [data, products] = await Promise.all([loadAnalytics(filters, storeId), listProducts(false, undefined, storeId)]);
  const exportQuery = new URLSearchParams({ range: filters.range, from: filters.from, to: filters.to, kind: filters.kind, product: filters.product });
  return <><NavSection href="/admin/analytics" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">HOW THE STORE IS DOING</span><h1>Analytics</h1><p>Sales over time, what sells, and where shoppers drop off.</p></div>
      <div className="admin-heading-actions"><a href={`/api/admin/analytics/export?${exportQuery}`} className="button secondary"><Download size={17} /> Export CSV</a></div>
    </div>
    <AnalyticsFrame filters={filters} products={products.map((product) => ({ id: product.id, name: product.name }))}>
      <AnalyticsReport data={data} />
    </AnalyticsFrame>
  </>;
}
