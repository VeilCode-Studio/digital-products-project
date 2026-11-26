import { ownerPage } from "@/lib/auth";
import { listProducts } from "@/lib/catalog";
import { listDomains, domainsEnabled } from "@/lib/domains";
import { domainConnectionReady } from "@/lib/domain-provider";
import { domainPurchasePreview } from "@/lib/domain-rules";
import { DomainsView } from "@/components/domains-view";
import { NavSection } from "@/components/admin-nav";
import type { StoreDomain } from "@/lib/domain-types";
import "../../domains.css";

export const dynamic = "force-dynamic";
export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  await ownerPage();
  const products = await listProducts();
  let domains: StoreDomain[] = [];
  let unavailable = false;
  try { domains = await listDomains(); } catch { unavailable = true; }
  return <><NavSection href="/admin/domains" />
    <div className="admin-page-heading"><div><span className="eyebrow">AN ADDRESS OF YOUR OWN</span><h1>Store domains</h1><p>Connect a memorable address to each product or physical store.</p></div></div>
    {unavailable && <p className="domains-error" role="alert">Domain records could not be loaded. Check the database update before connecting a domain.</p>}
    <DomainsView domains={domains} products={products.map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? "digital", status: p.status }))} ready={!unavailable && domainsEnabled() && domainConnectionReady()} purchasePreview={domainPurchasePreview()} selectedProduct={(await searchParams).product} />
  </>;
}
