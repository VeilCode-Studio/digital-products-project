"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { DomainPurchaseSummary } from "@/lib/domain-purchase-status";

const pendingStates = new Set(["checkout_pending", "paid", "registering", "registration_pending", "refund_pending"]);
const registrationLabels: Record<string, string> = { checkout_pending: "Waiting for payment", expired: "Not started", paid: "Payment received; waiting to register", registering: "Submitting registration", registration_pending: "Registrar is processing the order", registered: "Registration completed", registration_unknown: "Needs reconciliation", registration_failed: "Registration failed", refund_pending: "Registration failed", refunded: "Registration failed", refund_failed: "Registration failed" };
const paymentLabels: Record<string, string> = { pending: "Not paid", processing: "Processing", paid: "Payment succeeded", failed: "Payment declined — retry in Checkout", expired: "Checkout expired" };

export function DomainRegistrationResult({ id, initial, initialError }: { id: string; initial: DomainPurchaseSummary | null; initialError: string }) {
  const [purchase, setPurchase] = useState(initial);
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/admin/domain-purchases?id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const result = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(result.error || "Purchase status is unavailable.");
        setPurchase(result); setError("");
        if (!pendingStates.has(result.status)) return;
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "Status is unavailable."); }
      if (!cancelled && ++attempts < 20) timer = setTimeout(poll, 7000);
    }
    timer = setTimeout(poll, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);
  async function reconcile(resumeCheckout = false) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/domain-purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: resumeCheckout ? "resume_checkout" : "reconcile", id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Purchase status could not be confirmed.");
      if (resumeCheckout) window.location.assign(result.url || `/admin/domains?purchase=${id}`);
      else setPurchase(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Status is unavailable."); }
    finally { setPending(false); }
  }
  return <section className="workspace-panel domain-payment-result" aria-labelledby="domain-registration-result-title" aria-live="polite">
    <span className="domains-badge">{purchase?.sandbox ? "SANDBOX PURCHASE" : "DOMAIN PURCHASE"}</span>
    <h2 id="domain-registration-result-title">{purchase?.domain ?? "Your domain purchase"}</h2>
    {purchase && <>
      <dl className="domain-registration-status">
        <div><dt>Payment</dt><dd>{purchase.status === "refunded" ? "Refunded" : paymentLabels[purchase.paymentStatus] ?? purchase.paymentStatus}{purchase.sandbox ? " (test)" : ""}</dd></div>
        <div><dt>Registration</dt><dd>{registrationLabels[purchase.status] ?? "Checking status"}{purchase.sandbox ? " (simulated)" : ""}</dd></div>
        <div><dt>Store connection</dt><dd>{purchase.sandbox ? "Not connected — sandbox only" : purchase.connectionStatus === "active" ? "Connected" : purchase.connectionStatus === "pending" ? "Waiting for DNS, ownership verification or HTTPS" : "Not connected"}</dd></div>
        {["refund_pending", "refund_failed", "refunded"].includes(purchase.status) && <div><dt>Refund</dt><dd>{purchase.status === "refunded" ? "Refund succeeded" : purchase.status === "refund_failed" ? "Needs review" : "Processing"}{purchase.sandbox ? " (test)" : ""}</dd></div>}
      </dl>
      {purchase.failure && <p className="domains-note">{purchase.failure}</p>}
      {purchase.sandbox && <p>No real money moved and no real domain was registered or connected. Payment and refund statuses above come from Stripe&apos;s sandbox; registration is simulated.</p>}
      {purchase.checkoutUrl && purchase.paymentStatus !== "paid" && <a className="button" href={purchase.checkoutUrl}>Return to {purchase.sandbox ? "test " : ""}checkout</a>}
      {purchase.status === "registered" && !purchase.sandbox && purchase.connectionStatus !== "active" && <p>Your domain registration is complete. Check the connection below for DNS instructions and HTTPS readiness.</p>}
    </>}
    {error && <p className="domain-purchase-error" role="alert">{error}</p>}
    <div className="domains-actions">{purchase?.status === "checkout_pending" && !purchase.checkoutUrl && <Button type="button" className="button" disabled={pending} onClick={() => void reconcile(true)}>Recover checkout</Button>}<Button type="button" className="button secondary" disabled={pending} onClick={() => void reconcile()}>{pending ? "Checking purchase…" : "Check and resume processing"}</Button><Link className="text-link" href="/admin/domains">Back to domains</Link></div>
    <p className="domains-footnote">Purchase reference: {id}</p>
  </section>;
}
