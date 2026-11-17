"use client";
import { Copy, Mail, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import type { AbandonedCheckout } from "@/lib/abandoned";

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: amount % 100 ? 2 : 0 }).format(amount / 100);
}
const dates = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A follow-up email the owner sends from their own mail app; nothing is sent automatically. */
function followUp(entry: AbandonedCheckout, storeName: string) {
  const subject = `Your ${entry.product} is still waiting`;
  const body = `Hi,\n\nYou left ${entry.quantity > 1 ? `${entry.quantity} × ` : ""}${entry.product} in your cart at ${storeName}. It's saved for you here, and checkout takes a minute:\n\n${entry.recoveryUrl}\n\nAny questions, just reply to this email.\n\nThanks,\n${storeName}`;
  return `mailto:${encodeURIComponent(entry.email!)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function AbandonedCheckouts({ entries, storeName }: { entries: AbandonedCheckout[]; storeName: string }) {
  if (!entries.length) return <div className="empty-state compact"><ShoppingCart size={26} aria-hidden /><h3>No abandoned checkouts</h3><p>Carts that expire unpaid show up here for 30 days, with a link that reopens them.</p></div>;
  return <ul className="abandoned-list">
    {entries.map((entry) => <li key={entry.id} className="abandoned-row">
      <div className="abandoned-what">
        <strong>{entry.quantity > 1 ? `${entry.quantity} × ` : ""}{entry.product}</strong>
        <span>{entry.kind === "physical" ? `/s/${entry.productSlug}` : `/p/${entry.productSlug}`} · expired {dates.format(new Date(entry.expiredAt))}</span>
      </div>
      <strong className="abandoned-amount">{money(entry.amount, entry.currency)}</strong>
      <span className="abandoned-email">{entry.email ?? <em>No email: the shopper didn&apos;t opt in to updates</em>}</span>
      <div className="catalog-actions">
        {entry.recoveryUrl && <button type="button" className="button secondary small" onClick={async () => {
          await navigator.clipboard.writeText(entry.recoveryUrl!); toast.success("Recovery link copied", { description: "It reopens this cart until 30 days after it expired." });
        }}><Copy size={14} aria-hidden />Copy link</button>}
        {entry.email && entry.recoveryUrl && <a className="button primary small" href={followUp(entry, storeName)}><Mail size={14} aria-hidden />Email</a>}
      </div>
    </li>)}
  </ul>;
}
