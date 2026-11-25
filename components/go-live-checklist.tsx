"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, CircleDashed, Loader2, Plug } from "lucide-react";
import type { LiveCheck } from "@/lib/go-live";

type Manual = { id: string; title: string; detail: string; link?: { href: string; label: string } };
type Group = { id: string; title: string; intro: string; items: Manual[] };

/** What only the owner can check. Ticks are kept in this browser. */
const GROUPS: Group[] = [
  {
    id: "first-orders", title: "Watch on your first real CJ orders",
    intro: "Ordering and tracking were tested against CJ's sandbox, which can't pay or ship. Confirm these once with a real order, and tell me if anything differs.",
    items: [
      { id: "paid", title: "The first CJ order says it was paid", detail: "After “Place and pay”, the message should say “Placed and paid”. If it says payment hasn't been taken, pay it in CJ (My CJ → Orders) and let me know.", link: { href: "/admin/fulfillment", label: "Fulfilment" } },
      { id: "cost", title: "The cost recorded matches CJ's charge", detail: "Compare the order's supplier cost (and the variant's cost on Margins) with what CJ took from your wallet.", link: { href: "/admin/margins", label: "Margins" } },
      { id: "shipped", title: "The order moves to Shipped by itself", detail: "When CJ adds tracking (usually 1–5 days), the order should move to Shipped and the customer should get the tracking email. If it stays in Ordered, use “Check CJ for tracking”, then tell me what CJ shows." },
      { id: "delivered", title: "The order moves to Delivered by itself", detail: "When CJ marks it delivered. The review request email follows a few days later." },
      { id: "site-orders", title: "Orders you place on CJ's website", detail: "Paste CJ's order code (e.g. CJ2611…) as the supplier order number, so the store follows their tracking too." },
    ],
  },
  {
    id: "weekly", title: "Every week while you're selling",
    intro: "The store flags most of this for you above; these need your judgement.",
    items: [
      { id: "stock", title: "Turn off variants CJ has run out of", detail: "Out-of-stock alerts show on Margins, but the variant stays on sale until you switch it off in the store editor.", link: { href: "/admin/margins", label: "Margins" } },
      { id: "margins", title: "Check margins after price changes", detail: "Aim for 30% or more after product, shipping and card fees, before ad spend.", link: { href: "/admin/margins", label: "Margins" } },
      { id: "disputes", title: "Claim damaged or lost parcels from CJ", detail: "Open a dispute in CJ's dashboard (My CJ → Disputes) with photos, then refund or reship the customer. Filing disputes from here is planned once there's a real order to test with." },
      { id: "balance", title: "Keep your CJ wallet topped up", detail: "Orders can't be placed from Fulfilment when the balance won't cover them." },
    ],
  },
  {
    id: "business", title: "Business setup before scaling",
    intro: "These carry more risk than the code.",
    items: [
      { id: "stripe", title: "Stripe account in live mode and matching your business", detail: "Dropshipping gets extra review from Stripe; long delivery times and disputes can freeze a balance." },
      { id: "vercel", title: "Vercel Pro before selling at volume", detail: "The Hobby plan is for non-commercial use." },
      { id: "supabase", title: "Supabase Pro for production", detail: "Free projects pause after a quiet week, which would take the stores offline." },
      { id: "certs", title: "Certificates for regulated products", detail: "FCC marking for electronics (projectors, gadgets) and MoCRA rules for cosmetics. Ask CJ for the supplier's certificates before advertising." },
      { id: "policies", title: "Delivery times on store pages match CJ's", detail: "Your shipping profiles should promise what CJ's methods actually take, from the warehouse you ship from." },
      { id: "uk", title: "UK VAT before switching on the UK", detail: "Goods up to £135 sent to UK buyers usually need UK VAT from the first sale. Confirm with an accountant first." },
      { id: "search", title: "Google Search Console and Merchant Center", detail: "Submit the sitemap and product feed so products show in Google search and Shopping." },
    ],
  },
];

const STORAGE_KEY = "veilcode:go-live-ticks";
const readTicks = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>; } catch { return {}; }
};

function StatusIcon({ status }: { status: LiveCheck["status"] }) {
  if (status === "done") return <span className="golive-icon done" aria-label="Done"><Check size={14} /></span>;
  if (status === "warn") return <span className="golive-icon warn" aria-label="Worth a look"><AlertTriangle size={13} /></span>;
  return <span className="golive-icon todo" aria-label="To do"><CircleDashed size={14} /></span>;
}

function ConnectCj() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  return <div className="golive-action">
    <button type="button" className="button secondary small" disabled={pending} onClick={async () => {
      setPending(true); setMessage(null);
      try {
        const response = await fetch("/api/admin/fulfillment/cj", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect-updates" }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "CJ couldn't be reached. Please try again.");
        setMessage({ text: `Connected. CJ now sends updates for ${data.products} product${data.products === 1 ? "" : "s"}.`, failed: false });
        router.refresh();
      } catch (error) { setMessage({ text: (error as Error).message, failed: true }); } finally { setPending(false); }
    }}>{pending ? <Loader2 className="spin" size={14} /> : <Plug size={14} />}{pending ? "Connecting…" : "Connect CJ updates"}</button>
    {message && <p role="status" className={message.failed ? "form-error" : "save-success"}>{message.text}</p>}
  </div>;
}

export function GoLiveChecklist({ checks }: { checks: LiveCheck[] }) {
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  // Ticks live in this browser; localStorage is only readable after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTicks(readTicks()); }, []);
  const toggle = (id: string) => setTicks((current) => {
    const next = { ...current, [id]: !current[id] };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Not remembered; the tick still shows now. */ }
    return next;
  });
  const open = checks.filter((check) => check.status !== "done").length;

  return <div className="golive">
    <section className="workspace-panel golive-group">
      <header><h2>Checked by the store</h2><p>{open ? `${open} to look at. These update every time you open this page.` : "All clear. These update every time you open this page."}</p></header>
      <ul className="golive-list">{checks.map((check) => <li key={check.id} className={`golive-item is-${check.status}`}>
        <StatusIcon status={check.status} />
        <div>
          <strong>{check.title}</strong>
          <p>{check.detail}</p>
          {check.link && <Link href={check.link.href} className="golive-link">{check.link.label} <ArrowRight size={13} /></Link>}
          {check.action === "connect-cj" && <ConnectCj />}
        </div>
      </li>)}</ul>
    </section>

    {GROUPS.map((group) => {
      const done = group.items.filter((item) => ticks[`${group.id}:${item.id}`]).length;
      return <section key={group.id} className="workspace-panel golive-group">
        <header><h2>{group.title}</h2><p>{group.intro} <span className="golive-count">{done} of {group.items.length} ticked</span></p></header>
        <ul className="golive-list">{group.items.map((item) => {
          const key = `${group.id}:${item.id}`;
          return <li key={item.id} className={`golive-item${ticks[key] ? " is-ticked" : ""}`}>
            <input type="checkbox" id={`golive-${key}`} checked={!!ticks[key]} onChange={() => toggle(key)} />
            <div>
              <label htmlFor={`golive-${key}`}><strong>{item.title}</strong></label>
              <p>{item.detail}</p>
              {item.link && <Link href={item.link.href} className="golive-link">{item.link.label} <ArrowRight size={13} /></Link>}
            </div>
          </li>;
        })}</ul>
      </section>;
    })}
    <p className="muted golive-note">Ticks are saved in this browser only.</p>
  </div>;
}
