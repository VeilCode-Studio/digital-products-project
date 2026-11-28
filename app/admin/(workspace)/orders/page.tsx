import { Download } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { recentOrders } from "@/lib/dashboard";
import { getStore } from "@/lib/catalog";
import { NavSection } from "@/components/admin-nav";
import { OrdersTable } from "@/components/orders-table";
import { AbandonedCheckouts } from "@/components/abandoned-checkouts";
import { listAbandoned } from "@/lib/abandoned";

export const dynamic = "force-dynamic";
export default async function OrdersPage() {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const [store, orders, abandoned] = await Promise.all([getStore(storeId), recentOrders(100, storeId), listAbandoned(50, storeId)]);
  return <><NavSection href="/admin/orders" /><div className="admin-page-heading"><div><span className="eyebrow">FROM YOUR STUDIO TO THEIR INBOX</span><h1>Orders</h1><p>Your latest 100 purchases and their delivery status.</p></div>
    {/* A file download, so a plain link rather than client-side navigation. */}
    {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
    <a href="/api/admin/orders/export" className="button secondary"><Download size={17} /> Export recent CSV</a></div><section className="workspace-panel"><div className="panel-heading"><h2>Purchase history</h2><span className="muted">{orders.length} orders shown</span></div><OrdersTable orders={orders} actions /></section><section className="workspace-panel"><div className="panel-heading"><div><h2>Abandoned checkouts</h2><p>Shoppers who reached checkout but didn&apos;t pay. Each cart&apos;s link reopens it for 30 days.</p></div><span className="abandoned-count">{abandoned.length} in the last 30 days</span></div><AbandonedCheckouts entries={abandoned} storeName={store.name} /></section><p className="workspace-note">Amounts are gross payments. Process refunds in Stripe; refund and dispute statuses are not included here.</p></>;
}
