import { ownerPage } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { listProducts } from "@/lib/catalog";
import { recentOrders } from "@/lib/dashboard";
import { NavSection } from "@/components/admin-nav";
import { DashboardView } from "@/components/dashboard-view";

export const dynamic = "force-dynamic";
export default async function Dashboard() {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const [products, orders] = await Promise.all([listProducts(false, undefined, storeId), recentOrders(100, storeId)]);
  return <><NavSection href="/admin" /><DashboardView products={products} orders={orders} /></>;
}
