"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Link2, Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LINK_SOURCES, normalizeSlug, slugProblem, suggestSlugs, type LinkSource } from "@/lib/short-link-rules";
import type { ShortLink } from "@/lib/database.types";
import { formatMoney } from "@/lib/store-config";

export type LinkRow = ShortLink & { orders: number; revenue: number; currency: string | null; clicks7d: number };
type ProductChoice = { id: string; name: string; kind: "digital" | "physical"; live: boolean };

const SOURCE_LABELS: Record<LinkSource, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", facebook: "Facebook", other: "Other" };

async function call(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

/** The Links page (/admin/links): make a readable link for a video, copy it, and see what it earns. */
export function ShortLinks({ links, products, base }: { links: LinkRow[]; products: ProductChoice[]; base: string }) {
  const router = useRouter();
  const display = base.replace(/^https?:\/\//, "");
  const taken = useMemo(() => new Set(links.map((link) => link.slug)), [links]);
  const [productId, setProductId] = useState(products.find((product) => product.live)?.id ?? "home");
  const [slug, setSlug] = useState("");
  const [source, setSource] = useState<LinkSource>("tiktok");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<LinkRow | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const product = products.find((item) => item.id === productId) ?? null;
  const ideas = suggestSlugs(product?.name ?? "shop", taken);
  const clean = normalizeSlug(slug);
  const problem = slug ? slugProblem(clean) ?? (taken.has(clean) ? `/${clean} is already one of your links.` : null) : null;
  const productItems = [...products.map((item) => ({ value: item.id, label: `${item.name}${item.live ? "" : " (draft)"}` })), { value: "home", label: "Store home page" }];

  const create = async () => {
    if (!clean || problem) return;
    setPending("create"); setError("");
    try {
      await call({ action: "create", slug: clean, productId, source, label });
      toast.success(`${display}/${clean} is live`, { description: "Copy it from the list below." });
      setSlug(""); setLabel(""); router.refresh();
    } catch (failure) { setError((failure as Error).message); }
    setPending(null);
  };
  const toggle = async (link: LinkRow) => {
    setPending(link.id);
    try { await call({ action: "update", id: link.id, active: !link.active }); router.refresh(); }
    catch (failure) { toast.error((failure as Error).message); }
    setPending(null);
  };
  const retarget = async (link: LinkRow, next: string) => {
    setPending(link.id);
    try { await call({ action: "update", id: link.id, productId: next }); toast.success(`/${link.slug} now points somewhere new`, { description: "Videos already using it follow the change." }); router.refresh(); }
    catch (failure) { toast.error((failure as Error).message); }
    setPending(null);
  };
  const remove = async () => {
    if (!confirm) return;
    setPending("delete");
    try { await call({ action: "delete", id: confirm.id }); toast.success(`/${confirm.slug} deleted`); setConfirm(null); router.refresh(); }
    catch (failure) { toast.error((failure as Error).message); }
    setPending(null);
  };
  const copy = async (link: LinkRow) => {
    try { await navigator.clipboard.writeText(`${base}/${link.slug}`); toast.success("Link copied", { description: `${display}/${link.slug}` }); }
    catch { toast.error("Couldn't copy. Select the link and copy it instead."); }
  };

  return <>
    <section className="workspace-panel form-panel sl-create" aria-labelledby="sl-create-title">
      <div className="sl-create-head"><h2 id="sl-create-title">New short link</h2><p>Pick what it opens and a word people can read off a video and type.</p></div>
      <div className="sl-grid">
        <div className="sl-field sl-wide">
          <span className="sl-label" id="sl-product-label">Opens</span>
          <Select items={productItems} value={productId} onValueChange={(value) => { if (value !== null) { setProductId(String(value)); setSlug(""); } }}>
            <SelectTrigger aria-labelledby="sl-product-label" className="sl-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          {product && !product.live && <small className="sl-hint is-warn">This product is a draft, so the link opens the home page until you publish it.</small>}
        </div>
        <label className="sl-field sl-wide">
          <span className="sl-label">Link</span>
          <span className="sl-slug"><span>{display}/</span><input value={slug} onChange={(event) => setSlug(event.target.value)} onBlur={() => setSlug(clean)} placeholder={ideas[0] ?? "lamp"} maxLength={40} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={!!problem} aria-describedby="sl-slug-help" /></span>
          <small id="sl-slug-help" className={`sl-hint${problem ? " is-error" : ""}`}>{problem ?? "Short real words work best: easy to say, easy to type."}</small>
          {ideas.length > 0 && <span className="sl-ideas">{ideas.map((idea) => <button key={idea} type="button" onClick={() => setSlug(idea)} className={clean === idea ? "active" : ""}>/{idea}</button>)}</span>}
        </label>
        <div className="sl-field">
          <span className="sl-label" id="sl-source-label">Posted on</span>
          <Select items={LINK_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }))} value={source} onValueChange={(value) => { if (value !== null) setSource(value as LinkSource); }}>
            <SelectTrigger aria-labelledby="sl-source-label" className="sl-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{LINK_SOURCES.map((value) => <SelectItem key={value} value={value}>{SOURCE_LABELS[value]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="sl-field">
          <span className="sl-label">Note <span className="optional">optional</span></span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Unboxing video, 19 Nov" maxLength={80} />
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="button primary" onClick={create} disabled={!clean || !!problem || pending === "create"}><Plus size={16} />{pending === "create" ? "Creating…" : clean ? `Create ${display}/${clean}` : "Create link"}</button>
    </section>

    <section className="workspace-panel">
      <div className="panel-heading"><h2>Your links <span className="count">{links.length}</span></h2><span className="muted">Clicks and sales since each link was made</span></div>
      {links.length ? <div className="table-scroll"><table className="sl-table">
        <thead><tr><th>Link</th><th>Opens</th><th>Clicks</th><th>Sales</th><th><span className="sl-sr">Actions</span></th></tr></thead>
        <tbody>{links.map((link) => {
          const target = products.find((item) => item.id === link.product_id);
          return <tr key={link.id} className={link.active ? "" : "is-off"}>
            <td>
              <button type="button" className="sl-copy" onClick={() => copy(link)} title="Copy link"><span>{display}/<b>{link.slug}</b></span><Copy size={14} aria-hidden /></button>
              <small>{SOURCE_LABELS[link.source]}{link.label ? ` · ${link.label}` : ""}{link.active ? "" : " · Paused"}</small>
            </td>
            <td>
              <Select items={productItems} value={link.product_id ?? "home"} onValueChange={(value) => { if (value !== null && value !== (link.product_id ?? "home")) retarget(link, String(value)); }}>
                <SelectTrigger aria-label={`Where /${link.slug} opens`} className="sl-trigger sl-trigger-sm" disabled={pending === link.id}><SelectValue /></SelectTrigger>
                <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
              {link.product_id && !target && <small className="sl-hint is-warn">Product deleted: opens the home page</small>}
            </td>
            <td><strong>{link.clicks.toLocaleString("en-US")}</strong><small>{link.clicks7d} this week</small></td>
            <td><strong>{link.orders}</strong><small>{link.orders && link.currency ? formatMoney(link.revenue, link.currency) : "No sales yet"}</small></td>
            <td className="sl-actions">
              <button type="button" className="button secondary small" onClick={() => toggle(link)} disabled={pending === link.id}>{link.active ? "Pause" : "Turn on"}</button>
              <button type="button" className="sl-icon" onClick={() => setConfirm(link)} aria-label={`Delete /${link.slug}`}><Trash2 size={16} /></button>
            </td>
          </tr>;
        })}</tbody>
      </table></div>
        : <div className="empty-state"><Link2 size={28} /><h3>Your first short link starts here.</h3><p>Make one per video to see which videos actually sell.</p></div>}
    </section>

    <div className="workspace-note"><Check size={16} /> A paused or mistyped link opens your store&apos;s home page, never an error. Clicks from link previews and bots aren&apos;t counted.</div>

    <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open && pending !== "delete") setConfirm(null); }}>
      <AlertDialogContent className="confirm-dialog" initialFocus={keepRef}>
        <div className="confirm-dialog-icon danger" aria-hidden="true"><Trash2 size={22} /></div>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete /{confirm?.slug}?</AlertDialogTitle>
          <AlertDialogDescription>Anyone typing it from a video will land on your home page instead, and its click history goes too. To stop it for now, pause it instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={keepRef} className="button secondary" disabled={pending === "delete"}>Keep it</AlertDialogCancel>
          <AlertDialogAction type="button" className="button danger" disabled={pending === "delete"} onClick={remove}><Trash2 size={15} />{pending === "delete" ? "Deleting…" : "Delete link"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
