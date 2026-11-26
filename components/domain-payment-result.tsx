"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, Clock3, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DomainTestPayment } from "@/lib/domain-types";

export function DomainPaymentResult({ initial, sessionId, initialError, returnedCancelled }: {
  initial: DomainTestPayment | null; sessionId: string | null; initialError: string; returnedCancelled: boolean;
}) {
  const [payment, setPayment] = useState(initial);
  const [error, setError] = useState(initialError);
  const [checking, setChecking] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!sessionId) return;
    setChecking(true);
    try {
      const response = await fetch(`/api/admin/domain-checkout?session=${encodeURIComponent(sessionId)}`, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment status is unavailable. Please check again.");
      if (signal?.aborted) return;
      setPayment((current) => current?.status === "paid" ? current : data); setError("");
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : "Please check again."); }
    finally { if (!signal?.aborted) setChecking(false); }
  }, [sessionId]);

  // Stripe remains authoritative. Poll briefly after returning; later checks are explicit.
  useEffect(() => {
    if (!sessionId || payment?.status === "paid" || payment?.status === "expired") return;
    const controller = new AbortController();
    let checks = 0;
    let fetching = false;
    const timer = window.setInterval(() => {
      if (fetching) return;
      if (++checks > 24) { window.clearInterval(timer); return; }
      fetching = true;
      void refresh(controller.signal).finally(() => { fetching = false; });
    }, 5000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [sessionId, payment?.status, refresh]);

  const status = payment?.status;
  const paid = status === "paid";
  const failed = status === "failed";
  const closed = returnedCancelled && status === "pending";
  const title = paid ? "Test payment successful" : failed ? "Test payment failed" : status === "expired" ? "Test checkout expired"
    : status === "processing" ? "Payment processing" : closed || !sessionId ? "Checkout closed without payment confirmation"
    : payment ? "Payment not completed" : "Payment status unavailable";
  const Icon = paid ? CircleCheck : failed ? CircleAlert : status === "processing" ? Clock3 : CreditCard;
  return <section className="workspace-panel domain-payment-result" data-payment-state={status ?? "unknown"} aria-labelledby="domain-payment-title">
    <div className="domain-payment-heading"><Icon size={24} aria-hidden /><div><span className="eyebrow">STRIPE SANDBOX</span><h2 id="domain-payment-title" role="status">{title}</h2></div></div>
    {payment && <p className="domain-payment-domain">{payment.domain}<span>{new Intl.NumberFormat("en-US", { style: "currency", currency: payment.currency }).format(payment.amount / 100)} · test payment</span></p>}
    <p>{paid ? "Stripe confirmed this test payment. No real money moved."
      : failed ? payment?.failure : status === "expired" ? "This session has expired. Start a new checkout to try again."
      : status === "processing" ? "Stripe is still processing the payment. We will only show success once Stripe confirms it."
      : "Payment has not been confirmed. You can return to Checkout to complete it or try a different test card."}</p>
    <ol className="domain-payment-steps"><li data-complete="true">Quote reviewed</li><li data-complete={paid}>{paid ? "Payment confirmed" : failed ? "Payment declined" : "Awaiting payment"}</li><li>Domain registration off in test mode</li></ol>
    <p className="domain-payment-registration"><strong>Domain registration: not requested.</strong> This payment test cannot buy, reserve, renew or connect a real domain.</p>
    {error && <p className="domains-error" role="alert">{error}</p>}
    <div className="domains-actions">
      {payment?.checkoutUrl && !paid && <a className="button" href={payment.checkoutUrl}>{failed ? "Retry in Stripe Checkout" : "Continue in Stripe Checkout"}</a>}
      {sessionId && <Button className="button secondary" type="button" disabled={checking} onClick={() => void refresh()}>{checking ? "Checking Stripe…" : "Check payment status"}</Button>}
      <Link className="button secondary" href="/admin/domains">Start another test</Link>
    </div>
  </section>;
}
