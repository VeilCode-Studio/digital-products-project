import { ownerPage } from "@/lib/auth";
import { listProducts } from "@/lib/catalog";
import { listDomains, domainsEnabled } from "@/lib/domains";
import { domainConnectionReady } from "@/lib/domain-provider";
import { domainPurchasePreview } from "@/lib/domain-rules";
import { domainTestPaymentsEnabled } from "@/lib/domain-rules";
import { domainCheckoutCookie, domainTestPayment, DOMAIN_REQUEST_ID } from "@/lib/domain-checkout";
import { cookies } from "next/headers";
import { DomainPaymentResult } from "@/components/domain-payment-result";
import { HttpError } from "@/lib/http";
import type { DomainTestPayment } from "@/lib/domain-types";
import { DomainsView } from "@/components/domains-view";
import { NavSection } from "@/components/admin-nav";
import type { StoreDomain } from "@/lib/domain-types";
import "../../domains.css";

export const dynamic = "force-dynamic";
export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ product?: string; domain_payment?: string; domain_payment_return?: string; domain_request?: string }> }) {
  const owner = await ownerPage();
  const query = await searchParams;
  const paymentTest = domainTestPaymentsEnabled();
  const cancelRequest = query.domain_request && DOMAIN_REQUEST_ID.test(query.domain_request) ? query.domain_request : null;
  const sessionId = paymentTest ? query.domain_payment ?? (cancelRequest ? (await cookies()).get(domainCheckoutCookie(cancelRequest))?.value : null) ?? null : null;
  let payment: DomainTestPayment | null = null;
  let paymentError = "";
  if (sessionId) {
    try { payment = await domainTestPayment(sessionId, owner.id); }
    catch (error) { paymentError = error instanceof HttpError ? error.message : "Payment status is unavailable. Check again shortly."; }
  }
  const products = await listProducts();
  let domains: StoreDomain[] = [];
  let unavailable = false;
  try { domains = await listDomains(); } catch { unavailable = true; }
  return <><NavSection href="/admin/domains" />
    <div className="admin-page-heading"><div><span className="eyebrow">AN ADDRESS OF YOUR OWN</span><h1>Store domains</h1><p>Connect a memorable address to each product or physical store.</p></div></div>
    {paymentTest && (sessionId || query.domain_payment_return === "cancelled") && <DomainPaymentResult key={sessionId ?? "cancelled"} initial={payment} sessionId={sessionId} initialError={paymentError} returnedCancelled={query.domain_payment_return === "cancelled"} />}
    {unavailable && <p className="domains-error" role="alert">Domain records could not be loaded. Check the database update before connecting a domain.</p>}
    <DomainsView domains={domains} products={products.map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? "digital", status: p.status }))} ready={!unavailable && domainsEnabled() && domainConnectionReady()} purchasePreview={domainPurchasePreview()} selectedProduct={query.product} paymentTest={paymentTest} />
  </>;
}
