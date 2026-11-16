import Link from "next/link";
import { Store } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { getStore, listProducts } from "@/lib/catalog";
import { getSupabase } from "@/lib/supabase";
import { STORE_ID } from "@/lib/store-config";
import { AdminShell } from "@/components/admin-shell";
import { CatalogList } from "@/components/catalog-list";

export const dynamic = "force-dynamic";

/** The lowest active variant price of each physical store, for the list. */
async function storePrices() {
  const { data, error } = await getSupabase().from("product_variants").select("product_id, price_amount").eq("store_id", STORE_ID).eq("active", true);
  if (error) throw new Error("Could not load variant prices");
  const lowest = new Map<string, number>();
  for (const row of (data ?? []) as { product_id: string; price_amount: number }[]) {
    lowest.set(row.product_id, Math.min(row.price_amount, lowest.get(row.product_id) ?? Infinity));
  }
  return lowest;
}

/** Physical products: each one is its own single-product store at /s/<slug>. */
export default async function StoresPage() {
  const owner = await ownerPage();
  const [store, stores, prices] = await Promise.all([getStore(), listProducts(false, "physical"), storePrices()]);
  return <AdminShell storeName={store.name} owner={owner} active="/admin/stores">
    <div className="admin-page-heading">
      <div><span className="eyebrow">ONE PRODUCT, ONE STORE</span><h1>Physical stores</h1><p>Single-product stores for items shipped from your supplier.</p></div>
      <div className="admin-heading-actions">
        <Link href="/admin/products/new-store" className="button primary"><Store size={17} /> New store</Link>
      </div>
    </div>
    <section className="workspace-panel">
      <div className="panel-heading"><h2>Your stores <span className="count">{stores.length}</span></h2><span className="muted">{stores.filter((product) => product.status === "published").length} live</span></div>
      {stores.length ? <CatalogList products={stores} prices={prices} />
        : <div className="empty-state"><Store size={29} /><h3>Your first store starts here.</h3><p>Pick a winning product from Research, or start one from scratch.</p><Link href="/admin/products/new-store" className="button primary"><Store size={16} /> New store</Link></div>}
    </section>
    <p className="workspace-note">Orders for these stores arrive under Fulfilment, ready to place with the supplier.</p>
  </AdminShell>;
}
