import { ownerPage } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { listProducts } from "@/lib/catalog";
import { listDomains, domainsEnabled } from "@/lib/domains";
import { domainServiceState } from "@/lib/domain-provider";
import { domainPurchasePreview } from "@/lib/domain-rules";
import { domainTestPaymentsEnabled } from "@/lib/domain-rules";
import { domainCheckoutCookie, domainTestPayment, DOMAIN_REQUEST_ID } from "@/lib/domain-checkout";
import { cookies } from "next/headers";
import { DomainPaymentResult } from "@/components/domain-payment-result";
import { HttpError } from "@/lib/http";
import type { DomainTestPayment } from "@/lib/domain-types";
import { DomainsView } from "@/components/domains-view";
import { DomainRegistrationResult } from "@/components/domain-registration-result";
import { domainPurchaseContext, domainPurchaseMode } from "@/lib/domain-purchase-mode";
import { domainPurchaseStatus, type DomainPurchaseSummary } from "@/lib/domain-purchase-status";
import { NavSection } from "@/components/admin-nav";
import type { StoreDomain } from "@/lib/domain-types";
import "../../domains.css";

export const dynamic = "force-dynamic";
export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ product?: string; purchase?: string; domain_payment?: string; domain_payment_return?: string; domain_request?: string }> }) {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const query = await searchParams;
  const paymentTest = domainTestPaymentsEnabled();
  const purchaseMode = domainPurchaseMode();
  let purchase: DomainPurchaseSummary | null = null;
  let purchaseError = "";
  const purchaseId = purchaseMode && query.purchase && DOMAIN_REQUEST_ID.test(query.purchase) ? query.purchase : null;
  if (purchaseId) {
    try { purchase = await domainPurchaseStatus(purchaseId, domainPurchaseContext(owner.id, storeId)); }
    catch (error) { purchaseError = error instanceof HttpError ? error.message : "Purchase status could not be loaded. Please check again."; }
  }
  const cancelRequest = query.domain_request && DOMAIN_REQUEST_ID.test(query.domain_request) ? query.domain_request : null;
  const sessionId = paymentTest ? query.domain_payment ?? (cancelRequest ? (await cookies()).get(domainCheckoutCookie(cancelRequest))?.value : null) ?? null : null;
  let payment: DomainTestPayment | null = null;
  let paymentError = "";
  if (sessionId) {
    try { payment = await domainTestPayment(sessionId, owner.id); }
    catch (error) { paymentError = error instanceof HttpError ? error.message : "Payment status is unavailable. Check again shortly."; }
  }
  const [products, service] = await Promise.all([listProducts(false, undefined, storeId), domainServiceState()]);
  let domains: StoreDomain[] = [];
  let unavailable = false;
  try { domains = await listDomains(storeId); } catch { unavailable = true; }
  return <><NavSection href="/admin/domains" />
    <div className="admin-page-heading"><div><span className="eyebrow">AN ADDRESS OF YOUR OWN</span><h1>Store domains</h1><p>Connect a memorable address to each product or physical store.</p></div></div>
    {paymentTest && (sessionId || query.domain_payment_return === "cancelled") && <DomainPaymentResult key={sessionId ?? "cancelled"} initial={payment} sessionId={sessionId} initialError={paymentError} returnedCancelled={query.domain_payment_return === "cancelled"} />}
    {purchaseId && <DomainRegistrationResult key={purchaseId} id={purchaseId} initial={purchase} initialError={purchaseError} />}
    {unavailable && <p className="domains-error" role="alert">Domain records could not be loaded. Check the database update before connecting a domain.</p>}
    <DomainsView domains={domains} products={products.map((p) => ({ id: p.id, name: p.name, kind: p.kind ?? "digital", status: p.status }))} ready={!unavailable && domainsEnabled() && service.ready} connectionNotice={service.message} purchasePreview={domainPurchasePreview()} selectedProduct={query.product} paymentTest={paymentTest} purchaseMode={purchaseMode} />
  </>;
}
