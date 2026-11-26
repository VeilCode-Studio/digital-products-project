"use client";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DomainQuote } from "@/lib/domain-types";

const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

/** The parent only opens this for a complete, available quote. Registration remains disabled. */
export function DomainPurchaseDialog({ quote, open, onOpenChange, pending, renew, onRenewChange, onConfirm, error, paymentTest = false }: {
  quote: DomainQuote; open: boolean; onOpenChange: (open: boolean) => void; pending: boolean;
  renew: boolean; onRenewChange: (renew: boolean) => void; onConfirm: () => void; error?: string; paymentTest?: boolean;
}) {
  const term = `${quote.years} ${quote.years === 1 ? "year" : "years"}`;
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <DialogContent className="domain-purchase-dialog" overlayClassName="domain-purchase-overlay">
      <DialogHeader className="domain-purchase-heading">
        <span className="domain-purchase-badge">{paymentTest ? "Stripe test checkout" : "Purchase preview"}</span>
        <DialogTitle>Review your domain</DialogTitle>
        <DialogDescription>{paymentTest ? "Try successful or declined payments with a Stripe test card." : "Review the quote. Payment testing is available in staging."}</DialogDescription>
      </DialogHeader>
      <form className="domain-purchase-form" onSubmit={(event) => { event.preventDefault(); onConfirm(); }} aria-busy={pending}>
        <div className="domain-purchase-summary">
          <div className="domain-purchase-name">
            <span className="domain-purchase-icon"><Globe size={22} strokeWidth={1.6} aria-hidden /></span>
            <div><strong>{quote.domain}</strong><span>Your new store address</span></div>
          </div>
          <dl className="domain-purchase-prices">
            <div><dt>Registration <span>· {term}</span></dt><dd>{usd(quote.price!)}</dd></div>
            <div><dt>Renewal estimate <span>· {term}</span></dt><dd>{usd(quote.renewalPrice!)}</dd></div>
          </dl>
          <div className="domain-purchase-total"><div><span>{paymentTest ? "Test payment amount" : "Due today"}</span><small>{paymentTest ? "No real money moves" : "Preview only"}</small></div><strong>{paymentTest ? usd(quote.price!) : "$0.00"}</strong></div>
        </div>
        <label className="domain-purchase-renew">
          <Checkbox checked={renew} onCheckedChange={(checked) => onRenewChange(checked === true)} disabled={pending} />
          <span><strong>Automatic renewal</strong><span>{paymentTest ? "Saved with the test checkout. No renewal is scheduled." : "Preview this preference. Nothing is saved."}</span></span>
        </label>
        {error && <p className="domain-purchase-error" role="alert">{error}</p>}
        <DialogFooter className="domain-purchase-footer">
          <Button type="button" className="button secondary" disabled={pending} onClick={() => onOpenChange(false)}>Back</Button>
          <Button type="submit" className="button" disabled={pending}>{pending ? "Checking price…" : paymentTest ? "Continue to test payment" : "Check quote"}</Button>
        </DialogFooter>
        <p className="domain-purchase-footnote">{paymentTest ? "Use test cards only. No real domain will be registered." : "The domain won't be reserved or registered."}</p>
      </form>
    </DialogContent>
  </Dialog>;
}
