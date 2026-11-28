import { ownerPage } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { listProducts } from "@/lib/catalog";
import { linkStats, listShortLinks, shortLinkBase } from "@/lib/short-links";
import { NavSection } from "@/components/admin-nav";
import { ShortLinks, type LinkRow } from "@/components/short-links";

export const dynamic = "force-dynamic";
export default async function LinksPage() {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const products = await listProducts(false, undefined, storeId);
  let rows: LinkRow[] | null = null;
  try {
    const links = await listShortLinks(storeId);
    const stats = await linkStats(links, storeId);
    rows = links.map((link) => ({ ...link, ...(stats.get(link.slug) ?? { orders: 0, revenue: 0, currency: null, clicks7d: 0 }) }));
  } catch (error) {
    // Most likely the short links migration hasn't been applied to this database yet.
    console.error("Short links unavailable", error instanceof Error ? error.message.slice(0, 200) : "");
  }
  return <><NavSection href="/admin/links" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">LINKS PEOPLE CAN TYPE</span><h1>Short links</h1><p>Readable links for videos and captions, with the clicks and sales each one brings in.</p></div>
    </div>
    {rows ? <ShortLinks links={rows} base={shortLinkBase()} products={products.map((product) => ({ id: product.id, name: product.name, kind: product.kind === "physical" ? "physical" : "digital", live: product.status === "published" }))} />
      : <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">ONE STEP LEFT</span><h1>Short links aren&apos;t set up on this database yet.</h1><p>The short links database update needs to be applied before links can be created here.</p></section>}
  </>;
}
