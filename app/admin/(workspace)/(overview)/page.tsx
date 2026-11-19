import { ownerPage } from "@/lib/auth";
import { listProducts } from "@/lib/catalog";
import { recentOrders } from "@/lib/dashboard";
import { NavSection } from "@/components/admin-nav";
import { DashboardView } from "@/components/dashboard-view";

export const dynamic = "force-dynamic";
export default async function Dashboard() {
  await ownerPage();
  const [products, orders] = await Promise.all([listProducts(), recentOrders()]);
  return <><NavSection href="/admin" /><DashboardView products={products} orders={orders} /></>;
}
