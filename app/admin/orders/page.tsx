import { Download } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { recentOrders } from "@/lib/dashboard";
import { getStore } from "@/lib/catalog";
import { AdminShell } from "@/components/admin-shell";
import { OrdersTable } from "@/components/orders-table";
import { AbandonedCheckouts } from "@/components/abandoned-checkouts";
import { listAbandoned } from "@/lib/abandoned";

export const dynamic = "force-dynamic";
export default async function OrdersPage() {
  const owner = await ownerPage();
  const [store, orders, abandoned] = await Promise.all([getStore(), recentOrders(100), listAbandoned()]);
  return <AdminShell storeName={store.name} owner={owner} active="/admin/orders"><div className="admin-page-heading"><div><span className="eyebrow">FROM YOUR STUDIO TO THEIR INBOX</span><h1>Orders</h1><p>Your latest 100 purchases and their delivery status.</p></div><a href="/api/admin/orders/export" className="button secondary"><Download size={17} /> Export recent CSV</a></div><section className="workspace-panel"><div className="panel-heading"><h2>Purchase history</h2><span className="muted">{orders.length} orders shown</span></div><OrdersTable orders={orders} actions /></section><section className="workspace-panel"><div className="panel-heading"><h2>Abandoned checkouts</h2><span className="muted">Last 30 days · {abandoned.length} not recovered</span></div><p className="panel-intro">Shoppers who reached Stripe checkout but didn&apos;t pay. The link reopens their cart. Only email shoppers who ticked &ldquo;keep me updated&rdquo; at checkout; their address appears here.</p><AbandonedCheckouts entries={abandoned} storeName={store.name} /></section><p className="workspace-note">Amounts are gross payments. Process refunds in Stripe; refund and dispute statuses are not included here.</p></AdminShell>;
}
