"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Gift, Mail } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProductChoice = { id: string; name: string; hasFile: boolean; live: boolean };
type Row = { id: string; email: string; marketing: boolean; unsubscribed: boolean; joined: string; downloads: number };
type Summary = { total: number; consented: number; unsubscribed: number; last7: number };

const NONE = "none";
const day = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

/** The Subscribers page (/admin/subscribers): pick the free download, then watch the list grow. */
export function SubscribersView({ giftProductId, products, subscribers, summary }: { giftProductId: string | null; products: ProductChoice[]; subscribers: Row[]; summary: Summary }) {
  const router = useRouter();
  const [gift, setGift] = useState(giftProductId ?? NONE);
  const [pending, setPending] = useState(false);
  const usable = products.filter((product) => product.hasFile);
  const items = [{ value: NONE, label: "No free download" }, ...usable.map((product) => ({ value: product.id, label: `${product.name}${product.live ? "" : " (not for sale)"}` }))];

  const save = async (next: string) => {
    setGift(next); setPending(true);
    try {
      const response = await fetch("/api/admin/subscribers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "gift", productId: next === NONE ? null : next }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      toast.success(next === NONE ? "Free download switched off" : "Free download saved", { description: next === NONE ? "The sign-up form is hidden on your site." : "The sign-up form now shows on your homepage and product pages." });
      router.refresh();
    } catch (failure) { toast.error((failure as Error).message); setGift(giftProductId ?? NONE); }
    setPending(false);
  };

  return <>
    <section className="workspace-panel form-panel sl-create" aria-labelledby="sub-gift-title">
      <div className="sl-create-head"><h2 id="sub-gift-title">Free download</h2><p>Visitors get this product by email in exchange for their address. A short guide or checklist works best; it can be a product you don&apos;t sell.</p></div>
      <div className="sl-grid">
        <div className="sl-field sl-wide">
          <span className="sl-label" id="sub-gift-label">Give away</span>
          <Select items={items} value={gift} onValueChange={(value) => { if (value !== null && value !== gift) void save(String(value)); }}>
            <SelectTrigger aria-labelledby="sub-gift-label" className="sl-trigger" disabled={pending}><SelectValue /></SelectTrigger>
            <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <small className="sl-hint">{usable.length ? "Only digital products with an uploaded file can be given away." : "Upload a digital product's file first; it then appears here."}</small>
        </div>
      </div>
    </section>

    <div className="an-kpis">
      <div className="an-kpi"><span>Subscribers</span><strong>{summary.total.toLocaleString("en-US")}</strong><small>{summary.last7} in the last 7 days</small></div>
      <div className="an-kpi"><span>Open to offers</span><strong>{summary.consented.toLocaleString("en-US")}</strong><small>Ticked the box, still subscribed</small></div>
      <div className="an-kpi"><span>Opt-in rate</span><strong>{summary.total ? `${Math.round((summary.consented / summary.total) * 100)}%` : "—"}</strong><small>Of everyone who signed up</small></div>
      <div className="an-kpi"><span>Unsubscribed</span><strong>{summary.unsubscribed.toLocaleString("en-US")}</strong><small>Won&apos;t get marketing emails</small></div>
    </div>

    <section className="workspace-panel">
      <div className="panel-heading"><h2>Latest sign-ups <span className="count">{summary.total}</span></h2><span className="muted">{summary.total > subscribers.length ? `Newest ${subscribers.length}; export for everyone` : "Newest first"}</span></div>
      {subscribers.length ? <div className="table-scroll"><table className="sl-table">
        <thead><tr><th>Email</th><th>Marketing emails</th><th>Downloads</th><th>Joined</th></tr></thead>
        <tbody>{subscribers.map((entry) => <tr key={entry.id} className={entry.unsubscribed ? "is-off" : ""}>
          <td><strong>{entry.email}</strong></td>
          <td><strong>{entry.marketing ? "Yes" : "No"}</strong><small>{entry.unsubscribed ? "Unsubscribed" : entry.marketing ? "Ticked the box" : "Download only"}</small></td>
          <td><strong>{entry.downloads}</strong></td>
          <td><small>{day(entry.joined)}</small></td>
        </tr>)}</tbody>
      </table></div>
        : <div className="empty-state">{gift === NONE ? <Gift size={28} /> : <Mail size={28} />}<h3>{gift === NONE ? "Pick a free download to start your list." : "Your first subscriber is on the way."}</h3><p>{gift === NONE ? "The sign-up form appears on your site once a free download is chosen." : "The form is live on your homepage and product pages. Mention it in your videos."}</p></div>}
    </section>

    <div className="workspace-note"><Check size={16} /> Only people who ticked the box get marketing emails, and every one carries an unsubscribe link. The export includes each person&apos;s consent and when they gave it.</div>
  </>;
}
