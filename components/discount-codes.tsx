"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Plus, TicketPercent } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/store-config";
import type { DiscountCodeRow } from "@/lib/discount-codes";

const KINDS = [{ value: "percent", label: "Percentage off" }, { value: "amount", label: "Fixed amount off" }];
const CURRENCIES = [{ value: "usd", label: "USD ($)" }, { value: "gbp", label: "GBP (£)" }];

// Mirrors lib/discount-codes.ts normalizeCode, so the preview matches what gets saved.
const clean = (value: string) => value.toUpperCase().replace(/[\s_]+/g, "").replace(/[^A-Z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");

function describe(code: Pick<DiscountCodeRow, "percent_off" | "amount_off" | "currency">) {
  return code.percent_off ? `${code.percent_off}% off` : `${formatMoney(code.amount_off ?? 0, code.currency ?? "usd")} off`;
}
function limits(code: DiscountCodeRow) {
  const parts = [code.expires_at ? `Ends ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(code.expires_at))}` : "No end date"];
  if (code.max_redemptions) parts.push(`${code.stats.orders} of ${code.max_redemptions} uses`);
  return parts.join(" · ");
}
function status(code: DiscountCodeRow) {
  if (!code.active) return "Paused";
  if (code.expires_at && Date.parse(code.expires_at) <= Date.now()) return "Ended";
  if (code.max_redemptions !== null && code.stats.orders >= code.max_redemptions) return "Used up";
  return "Live";
}

async function call(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/discounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

/** The Discount codes page (/admin/discounts): make a code for a video or promotion, and see what it earns. */
export function DiscountCodes({ codes, thankYouCodeId }: { codes: DiscountCodeRow[]; thankYouCodeId: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState("percent");
  const [value, setValue] = useState("10");
  const [currency, setCurrency] = useState("usd");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [thankYou, setThankYou] = useState(thankYouCodeId ?? "none");
  const thankYouItems = [{ value: "none", label: "Don't show a code" }, ...codes.filter((entry) => entry.usable).map((entry) => ({ value: entry.id, label: `${entry.code} (${describe(entry)})` }))];
  const saveThankYou = async (next: string) => {
    setThankYou(next);
    try {
      await call({ action: "thank-you", id: next === "none" ? null : next });
      toast.success(next === "none" ? "Thank-you pages show no code" : "Code added to thank-you pages", { description: next === "none" ? undefined : "Buyers see it right after paying, as a reason to come back." });
      router.refresh();
    } catch (failure) { toast.error((failure as Error).message); setThankYou(thankYouCodeId ?? "none"); }
  };

  const normalized = clean(code);
  const taken = codes.some((entry) => entry.code === normalized);
  const problem = !code ? null : normalized.length < 3 ? "Use at least 3 letters or numbers." : normalized.length > 24 ? "Keep it to 24 characters or fewer." : taken ? `${normalized} already exists.` : null;
  const amount = Number(value);
  const valueProblem = kind === "percent" ? (!Number.isInteger(amount) || amount < 1 || amount > 90 ? "From 1 to 90." : null) : (!(amount > 0) || amount > 1000 ? "Between 0.01 and 1,000." : null);
  const today = new Date().toISOString().slice(0, 10);

  const create = async () => {
    if (!normalized || problem || valueProblem) return;
    setPending("create"); setError("");
    try {
      await call({ action: "create", code: normalized, kind, value: amount, currency, maxRedemptions: maxRedemptions || null, expiresAt: expiresAt || null, label });
      toast.success(`${normalized} is live`, { description: "Shoppers can type it at checkout now." });
      setCode(""); setLabel(""); setMaxRedemptions(""); setExpiresAt(""); router.refresh();
    } catch (failure) { setError((failure as Error).message); }
    setPending(null);
  };
  const toggle = async (entry: DiscountCodeRow) => {
    setPending(entry.id);
    try {
      await call({ action: "active", id: entry.id, active: !entry.active });
      toast.success(entry.active ? `${entry.code} paused` : `${entry.code} is live again`);
      router.refresh();
    } catch (failure) { toast.error((failure as Error).message); }
    setPending(null);
  };
  const copy = async (entry: DiscountCodeRow) => {
    try { await navigator.clipboard.writeText(entry.code); toast.success("Code copied", { description: entry.code }); }
    catch { toast.error("Couldn't copy. Select the code and copy it instead."); }
  };

  return <>
    <section className="workspace-panel form-panel sl-create" aria-labelledby="dc-create-title">
      <div className="sl-create-head"><h2 id="dc-create-title">New discount code</h2><p>Say it in a video or caption. It works on every product, digital and physical, once per order.</p></div>
      <div className="sl-grid">
        <label className="sl-field">
          <span className="sl-label">Code</span>
          <input value={code} onChange={(event) => setCode(event.target.value)} onBlur={() => setCode(normalized)} placeholder="TIKTOK10" maxLength={30} autoCapitalize="characters" autoCorrect="off" spellCheck={false} aria-invalid={!!problem} aria-describedby="dc-code-help" />
          <small id="dc-code-help" className={`sl-hint${problem ? " is-error" : ""}`}>{problem ?? "Short and easy to say. Shoppers can type it in any case."}</small>
        </label>
        <div className="sl-field">
          <span className="sl-label" id="dc-kind-label">Discount</span>
          <Select items={KINDS} value={kind} onValueChange={(next) => { if (next !== null) { setKind(String(next)); setValue(next === "percent" ? "10" : "5"); } }}>
            <SelectTrigger aria-labelledby="dc-kind-label" className="sl-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{KINDS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="sl-field">
          <span className="sl-label">{kind === "percent" ? "Percent off" : "Amount off"}</span>
          <input type="number" inputMode="decimal" min={kind === "percent" ? 1 : 0.01} max={kind === "percent" ? 90 : 1000} step={kind === "percent" ? 1 : 0.01} value={value} onChange={(event) => setValue(event.target.value)} aria-invalid={!!valueProblem} aria-describedby="dc-value-help" />
          <small id="dc-value-help" className={`sl-hint${valueProblem ? " is-error" : ""}`}>{valueProblem ?? (kind === "percent" ? "Of the order before shipping." : "Taken off the order before shipping.")}</small>
        </label>
        {kind === "amount" && <div className="sl-field">
          <span className="sl-label" id="dc-currency-label">Currency</span>
          <Select items={CURRENCIES} value={currency} onValueChange={(next) => { if (next !== null) setCurrency(String(next)); }}>
            <SelectTrigger aria-labelledby="dc-currency-label" className="sl-trigger"><SelectValue /></SelectTrigger>
            <SelectContent>{CURRENCIES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          <small className="sl-hint">Only applies to orders in this currency.</small>
        </div>}
        <label className="sl-field">
          <span className="sl-label">Total uses <span className="optional">optional</span></span>
          <input type="number" inputMode="numeric" min={1} step={1} value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} placeholder="Unlimited" />
        </label>
        <label className="sl-field">
          <span className="sl-label">Last day <span className="optional">optional</span></span>
          <input type="date" min={today} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
        <label className="sl-field">
          <span className="sl-label">Note <span className="optional">optional</span></span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Launch video, 20 Nov" maxLength={80} />
        </label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="button primary" onClick={create} disabled={!normalized || !!problem || !!valueProblem || pending === "create"}><Plus size={16} />{pending === "create" ? "Creating…" : normalized ? `Create ${normalized}` : "Create code"}</button>
    </section>

    {codes.length > 0 && <section className="workspace-panel form-panel sl-create" aria-labelledby="dc-ty-title">
      <div className="sl-create-head"><h2 id="dc-ty-title">Thank-you pages</h2><p>Show one code right after someone pays, as a reason to come back. It disappears by itself once the code is paused, ends or is used up.</p></div>
      <div className="sl-grid"><div className="sl-field sl-wide">
        <span className="sl-label" id="dc-ty-label">Code to show</span>
        <Select items={thankYouItems} value={thankYou} onValueChange={(next) => { if (next !== null && next !== thankYou) void saveThankYou(String(next)); }}>
          <SelectTrigger aria-labelledby="dc-ty-label" className="sl-trigger"><SelectValue /></SelectTrigger>
          <SelectContent>{thankYouItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
        <small className="sl-hint">A limited code works well here, such as 15% off with 100 uses, so it stays a thank-you rather than a standing discount.</small>
      </div></div>
    </section>}

    <section className="workspace-panel">
      <div className="panel-heading"><h2>Your codes <span className="count">{codes.length}</span></h2><span className="muted">Paid orders that used each code</span></div>
      {codes.length ? <div className="table-scroll"><table className="sl-table">
        <thead><tr><th>Code</th><th>Discount</th><th>Orders</th><th>Sales</th><th><span className="sl-sr">Actions</span></th></tr></thead>
        <tbody>{codes.map((entry) => <tr key={entry.id} className={entry.usable ? "" : "is-off"}>
          <td>
            <button type="button" className="sl-copy" onClick={() => copy(entry)} title="Copy code"><span><b>{entry.code}</b></span><Copy size={14} aria-hidden /></button>
            <small>{status(entry)}{entry.label ? ` · ${entry.label}` : ""}{entry.livemode ? "" : " · Test mode"}</small>
          </td>
          <td><strong>{describe(entry)}</strong><small>{limits(entry)}</small></td>
          <td><strong>{entry.stats.orders}</strong><small>{entry.stats.discounted && entry.stats.currency ? `${formatMoney(entry.stats.discounted, entry.stats.currency)} given` : "None yet"}</small></td>
          <td><strong>{entry.stats.orders && entry.stats.currency ? formatMoney(entry.stats.revenue, entry.stats.currency) : "—"}</strong><small>After refunds</small></td>
          <td className="sl-actions">
            <button type="button" className="button secondary small" onClick={() => toggle(entry)} disabled={pending === entry.id}>{entry.active ? "Pause" : "Turn on"}</button>
          </td>
        </tr>)}</tbody>
      </table></div>
        : <div className="empty-state"><TicketPercent size={28} /><h3>Your first code starts here.</h3><p>Pair a code with a short link in each video to see what really sells.</p></div>}
    </section>

    <div className="workspace-note"><Check size={16} /> Stripe checks every code at checkout, so a paused, ended or used-up code is simply refused there. Codes live in the Stripe account taking payments; if you switch accounts, create them again.</div>
  </>;
}
