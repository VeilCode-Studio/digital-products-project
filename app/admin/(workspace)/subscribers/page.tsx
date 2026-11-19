import { ownerPage } from "@/lib/auth";
import { listProducts, getStore } from "@/lib/catalog";
import { listSubscribers } from "@/lib/subscribers";
import { NavSection } from "@/components/admin-nav";
import { SubscribersView } from "@/components/subscribers-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscribers" };

export default async function SubscribersPage() {
  await ownerPage();
  const [store, products, list] = await Promise.all([getStore(), listProducts(false, "digital"), listSubscribers().catch(() => null)]);
  return <><NavSection href="/admin/subscribers" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">PEOPLE WHO ASKED TO HEAR FROM YOU</span><h1>Subscribers</h1><p>Visitors swap their email for a free download. Those who tick the box can hear about launches and offers.</p></div>
      {list && list.summary.total > 0 && <div className="admin-heading-actions">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a file download, not a page */}
        <a className="button secondary" href="/api/admin/subscribers/export">Export CSV</a>
      </div>}
    </div>
    {list ? <SubscribersView
      giftProductId={store.gift_product_id ?? null}
      products={products.map((product) => ({ id: product.id, name: product.name, hasFile: !!product.storage_path, live: product.status === "published" }))}
      subscribers={list.subscribers.slice(0, 200).map((entry) => ({ id: entry.id, email: entry.email, marketing: entry.marketing_consent, unsubscribed: !!entry.unsubscribed_at, joined: entry.created_at, downloads: entry.download_count }))}
      summary={list.summary} />
      : <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">TRY AGAIN SHORTLY</span><h1>Subscribers couldn&apos;t load.</h1><p>Reload the page in a moment.</p></section>}
  </>;
}
