import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore, listProducts } from "@/lib/catalog";
import { ProductTile, SiteFooter, SiteHeader } from "@/components/site/chrome";
import { monaSans } from "@/app/studio-fonts";
import { productPath, STORE_UUID } from "@/lib/storefront-paths";
import "@/app/studio.css";

export const dynamic = "force-dynamic";
export default async function Shop({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  if (!STORE_UUID.test(storeId)) notFound();
  const store = await getStore(storeId).catch(() => null);
  if (!store) notFound();
  const products = await listProducts(true, undefined, storeId);
  return <div className={`vc ${monaSans.variable}`}>
    <SiteHeader store={store} nav={false} />
    <main className="vc-wrap vc-legal" id="collection">
      <h1 className="vc-heading">{store.name}</h1><p>{store.bio || store.tagline}</p>
      <div className="vc-product-grid">
        {products.map(product => product.kind === "digital" ? <ProductTile key={product.id} product={product} /> : <article key={product.id}><h2><Link href={productPath(product)}>{product.name}</Link></h2><p>{product.tagline}</p></article>)}
        {!products.length && <p>New products are on their way. Check back soon.</p>}
      </div>
    </main>
    <SiteFooter store={store} products={products.filter(p => p.kind === "digital")} support={store.support_email} base={`/shops/${storeId}/`} />
  </div>;
}
