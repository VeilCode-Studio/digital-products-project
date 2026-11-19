"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, ExternalLink, Percent } from "lucide-react";
import { formatMoney } from "@/lib/store-config";
import type { MarginRow, MarginSummary } from "@/lib/margins";

const SUPPLIERS: Record<string, string> = { cj: "CJ Dropshipping", aliexpress: "AliExpress", alibaba: "Alibaba", other: "Supplier" };
const SOURCES: Record<string, string> = { manual: "entered by you", order: "from your last order", cj: "from CJ" };
const ago = (value: string | null) => {
  if (!value) return "never";
  const days = Math.floor((Date.now() - Date.parse(value)) / 86400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
// The same sum as lib/margins.ts unitMargin, so the badge updates while typing.
const fee = (price: number) => Math.round(price * 0.029) + 30;
function marginOf(price: number, cost: string, shipping: string) {
  if (cost === "" || price <= 0) return null;
  const profit = price - Math.round(Number(cost) * 100) - Math.round(Number(shipping || 0) * 100) - fee(price);
  return Number.isFinite(profit) ? profit / price : null;
}
const toInput = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2);

function Badge({ margin, target }: { margin: number | null; target: number }) {
  if (margin === null) return <span className="mg-badge is-none">No cost yet</span>;
  const tone = margin >= target ? "is-good" : margin >= target / 2 ? "is-warn" : "is-bad";
  return <span className={`mg-badge ${tone}`}>{Math.round(margin * 100)}%</span>;
}

function Row({ row, target }: { row: MarginRow; target: number }) {
  const router = useRouter();
  const [cost, setCost] = useState(toInput(row.unitCost));
  const [shipping, setShipping] = useState(toInput(row.supplierShipping));
  const [pending, setPending] = useState<string | null>(null);
  const dirty = cost !== toInput(row.unitCost) || shipping !== toInput(row.supplierShipping);
  const live = marginOf(row.price, cost, shipping);

  const send = async (action: "cost" | "checked") => {
    setPending(action);
    try {
      const response = await fetch("/api/admin/margins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, variantId: row.variantId, unitCost: cost, supplierShipping: shipping }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      toast.success(action === "cost" ? "Cost saved" : "Marked as checked", { description: action === "checked" ? "We'll remind you again in a week." : undefined });
      router.refresh();
    } catch (failure) { toast.error((failure as Error).message); }
    setPending(null);
  };

  return <tr className={row.alert || (live !== null && live < target) ? "mg-flag" : ""}>
    <td>
      <strong>{row.label}</strong>
      <small>Sells for {formatMoney(row.price, row.currency)}{row.unitCost !== null && row.costSource ? ` · cost ${SOURCES[row.costSource]}` : ""}</small>
      {row.alert && <small className="mg-alert"><AlertTriangle size={13} aria-hidden="true" /> {row.alert}</small>}
    </td>
    <td><label className="mg-money"><span>{row.currency.toUpperCase()}</span><input type="number" inputMode="decimal" min={0} step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="0.00" aria-label={`Unit cost for ${row.productName} ${row.label}`} /></label></td>
    <td><label className="mg-money"><span>{row.currency.toUpperCase()}</span><input type="number" inputMode="decimal" min={0} step="0.01" value={shipping} onChange={(event) => setShipping(event.target.value)} placeholder="0.00" aria-label={`Supplier shipping for ${row.productName} ${row.label}`} /></label></td>
    <td><Badge margin={live} target={target} />{live !== null && <small>{formatMoney(Math.round(live * row.price), row.currency)} a sale</small>}</td>
    <td>
      {row.supplierUrl ? <a className="mg-supplier" href={row.supplierUrl} target="_blank" rel="noreferrer">{SUPPLIERS[row.supplier ?? "other"]} <ExternalLink size={12} aria-hidden="true" /></a> : <small>No supplier link</small>}
      <small className={row.checkDue ? "mg-due" : ""}>{row.supplier === "cj" ? `Checked daily · ${ago(row.checkedAt)}` : row.supplierUrl ? `Checked ${ago(row.checkedAt)}` : "Add it in the store editor"}</small>
    </td>
    <td className="sl-actions">
      {dirty ? <button type="button" className="button primary small" disabled={!!pending} onClick={() => send("cost")}>{pending === "cost" ? "Saving…" : "Save"}</button>
        : row.supplierUrl && row.supplier !== "cj" ? <button type="button" className="button secondary small" disabled={!!pending} onClick={() => send("checked")} title="The supplier's price is unchanged"><Check size={14} /> {pending === "checked" ? "Saving…" : "Checked"}</button> : null}
    </td>
  </tr>;
}

/** The Margins page (/admin/margins): costs per variant, the margin they leave, and supplier checks. */
export function MarginsView({ rows, summary, target }: { rows: MarginRow[]; summary: MarginSummary; target: number }) {
  const products = [...new Map(rows.map((row) => [row.productId, row])).values()];
  return <>
    <div className="an-kpis">
      <div className="an-kpi"><span>Below {Math.round(target * 100)}% margin</span><strong>{summary.belowTarget}</strong><small>Variants to reprice or re-source</small></div>
      <div className="an-kpi"><span>Missing a cost</span><strong>{summary.missingCost}</strong><small>Margin unknown until you add it</small></div>
      <div className="an-kpi"><span>Supplier checks due</span><strong>{summary.checksDue}</strong><small>Not checked in the last week</small></div>
      <div className="an-kpi"><span>Price alerts</span><strong>{summary.alerts}</strong><small>Supplier got dearer or stopped listing</small></div>
    </div>

    {products.length ? products.map((product) => <section className="workspace-panel" key={product.productId}>
      <div className="panel-heading"><h2>{product.productName}{!product.live && <span className="count">Draft</span>}</h2><Link className="muted" href={`/admin/products/${encodeURIComponent(product.productId)}`}>Edit store</Link></div>
      <div className="table-scroll"><table className="sl-table mg-table">
        <thead><tr><th>Variant</th><th>Unit cost</th><th>Supplier shipping</th><th>Margin</th><th>Supplier</th><th><span className="sl-sr">Actions</span></th></tr></thead>
        <tbody>{rows.filter((row) => row.productId === product.productId).map((row) => <Row key={row.variantId} row={row} target={target} />)}</tbody>
      </table></div>
    </section>)
      : <section className="workspace-panel"><div className="empty-state"><Percent size={28} /><h3>No physical products yet.</h3><p>Once a physical store has variants, their costs and margins appear here.</p></div></section>}

    <div className="workspace-note"><Check size={16} /> Margin is what&apos;s left after the supplier&apos;s price, their shipping and estimated card fees (2.9% + 30¢), before ad spend. Aim for {Math.round(target * 100)}% or more. When you mark an order as ordered with what you paid, that becomes the cost automatically.</div>
  </>;
}
