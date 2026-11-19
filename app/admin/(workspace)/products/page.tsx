import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { listProducts } from "@/lib/catalog";
import { NavSection } from "@/components/admin-nav";
import { CatalogList } from "@/components/catalog-list";

export const dynamic = "force-dynamic";

/** Digital downloads only. Physical single-product stores live under /admin/stores. */
export default async function ProductsPage() {
  await ownerPage();
  const products = await listProducts(false, "digital");
  return <><NavSection href="/admin/products" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">YOUR SHELF</span><h1>Digital products</h1><p>Guides, templates and downloads, delivered by email the moment someone pays.</p></div>
      <div className="admin-heading-actions">
        <Link href="/admin/products/new" className="button primary"><Plus size={17} /> Digital product</Link>
      </div>
    </div>
    <section className="workspace-panel">
      <div className="panel-heading"><h2>Your downloads <span className="count">{products.length}</span></h2><span className="muted">{products.filter((product) => product.status === "published").length} published</span></div>
      {products.length ? <CatalogList products={products} />
        : <div className="empty-state"><Package size={29} /><h3>A home for your first idea.</h3><p>Upload a guide or template, set a price and publish it.</p><Link href="/admin/products/new" className="button primary"><Plus size={16} /> Digital product</Link></div>}
    </section>
    <p className="workspace-note">Prices and checkout are managed from here. Stripe handles the payment.</p>
  </>;
}
