"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Globe, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { DomainQuote, StoreDomain } from "@/lib/domain-types";

type Product = { id: string; name: string; kind: string; status: string };
const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
async function call(body: object) {
  const response = await fetch("/api/admin/domains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Couldn't complete that request. Please try again.");
  return data;
}

export function DomainsView({ domains, products, ready, purchasePreview, selectedProduct }: {
  domains: StoreDomain[]; products: Product[]; ready: boolean; purchasePreview: boolean; selectedProduct?: string;
}) {
  const router = useRouter();
  const [productId, setProductId] = useState(selectedProduct && products.some((p) => p.id === selectedProduct) ? selectedProduct : products[0]?.id ?? "");
  const [hostname, setHostname] = useState("");
  const [search, setSearch] = useState("");
  const [quote, setQuote] = useState<DomainQuote | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [remove, setRemove] = useState<StoreDomain | null>(null);
  const [renew, setRenew] = useState(false);
  const [rehearsed, setRehearsed] = useState(false);
  async function run(key: string, body: object, done: (data: Awaited<ReturnType<typeof call>>) => void) {
    if (pending) return;
    setPending(key); setError("");
    try { done(await call(body)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setPending(null); router.refresh(); }
  }
  const quoted = quote?.available && typeof quote.price === "number" && Number.isFinite(quote.price) && typeof quote.renewalPrice === "number" && Number.isFinite(quote.renewalPrice) && typeof quote.years === "number";
  return <div className="domains-workspace">
    {error && <p className="domains-error" role="alert">{error}</p>}
    <div className="domains-grid">
      <section className="workspace-panel domains-panel" aria-labelledby="connect-domain-title">
        <Globe className="domains-icon" size={23} aria-hidden />
        <h2 id="connect-domain-title">Bring your own domain</h2>
        <p>Give a product or physical store its own address. Keep your domain with your current registrar.</p>
        {!ready && <p className="domains-note">Connections need provider configuration before they can be added. Domain search below can still be reviewed in staging.</p>}
        <form onSubmit={(event) => { event.preventDefault(); void run("connect", { action: "connect", productId, hostname }, () => { setHostname(""); toast.success("Domain added", { description: "Follow the DNS instructions below, then check the connection." }); }); }}>
          <label htmlFor="domain-product">Product or store</label>
          <Select value={productId} onValueChange={(value) => setProductId(value ?? "")}>
            <SelectTrigger id="domain-product" className="domains-select"><SelectValue>{products.find((p) => p.id === productId)?.name ?? "Choose a store"}</SelectValue></SelectTrigger>
            <SelectContent>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}{product.status === "draft" ? " · Draft" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <label htmlFor="domain-host">Domain name</label>
          <Input id="domain-host" autoCapitalize="none" autoCorrect="off" placeholder="shop.mybrand.com" value={hostname} onChange={(event) => setHostname(event.target.value)} required maxLength={253} />
          <Button type="submit" className="button" disabled={!ready || !productId || !hostname.trim() || !!pending}>{pending === "connect" ? "Connecting…" : "Connect domain"}</Button>
        </form>
        <p className="domains-footnote">One primary domain per product. A draft stays private until you publish it.</p>
      </section>
      {purchasePreview && <section className="workspace-panel domains-panel domains-search" aria-labelledby="find-domain-title">
        <span className="domains-badge">STAGING PREVIEW</span>
        <h2 id="find-domain-title">Find your next address</h2>
        <p>Search live availability and prices, then try the purchase flow. This preview cannot charge you or register a domain.</p>
        <form onSubmit={(event) => { event.preventDefault(); setQuote(null); setRehearsed(false); void run("search", { action: "search", hostname: search }, (data) => setQuote(data.quotes[0] ?? null)); }}>
          <label htmlFor="domain-search">Domain to search</label>
          <div className="domains-search-input"><Input id="domain-search" placeholder="mynewbrand.com" autoCapitalize="none" autoCorrect="off" value={search} onChange={(event) => { setSearch(event.target.value); setQuote(null); setRehearsed(false); }} required maxLength={253} /><Button type="submit" className="button secondary" disabled={!!pending || !search.trim()}><Search size={16} aria-hidden />{pending === "search" ? "Searching…" : "Search"}</Button></div>
        </form>
        {quote && <div className="domains-quote" aria-live="polite">
          <strong>{quote.domain}</strong>
          {quoted ? <>
            <span className="domains-available"><Check size={15} aria-hidden />Available{quote.premium ? " · Premium domain" : ""}</span>
            <div className="domains-price">{usd(quote.price!)} <span>for {quote.years} {quote.years === 1 ? "year" : "years"}</span></div>
            <p>Renewal: {usd(quote.renewalPrice!)} for the quoted term. Prices and availability can change.</p>
            <Button type="button" className="button" disabled={!!pending} onClick={() => { setRenew(false); setReview(true); }}>Preview purchase</Button>
          </> : <p>Unavailable, or availability and pricing could not be confirmed. Try another name.</p>}
        </div>}
        {rehearsed && <p className="domains-success" role="status">Purchase preview completed. No payment was taken and no domain was registered or connected.</p>}
      </section>}
    </div>
    <section className="workspace-panel domains-panel" aria-labelledby="connected-domains-title">
      <h2 id="connected-domains-title">Your domains</h2>
      {!domains.length && <p>No custom domains yet. Your existing product and store links continue to work.</p>}
      {domains.map((domain) => <article className="domain-row" key={domain.id}>
        <div className="domain-row-head"><div><strong>{domain.hostname}</strong><p>{products.find((p) => p.id === domain.product_id)?.name ?? "Product"}</p></div><span className={`domains-status ${domain.status}`}>{domain.status === "active" ? "Connected" : "Awaiting verification"}</span></div>
        {domain.status === "pending" && <p>Add the records below at your DNS provider, then check the connection. Keep your email and other existing DNS records. HTTPS may take a little longer after DNS is ready.</p>}
        {domain.verification.length > 0 && <div className="domains-dns"><table><caption>Required DNS records</caption><thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Value</th></tr></thead><tbody>{domain.verification.map((record, index) => <tr key={index}><td>{record.type}</td><td><code>{record.name}</code></td><td><code>{record.value}</code></td></tr>)}</tbody></table></div>}
        {domain.status === "pending" && !domain.verification.length && <p className="domains-note">Check the connection to load the provider&apos;s DNS instructions. If the domain was not added successfully, remove this connection and try again.</p>}
        <div className="domains-actions">
          <Button type="button" className="button secondary" disabled={!!pending || !ready} onClick={() => void run(domain.id, { action: "check", id: domain.id }, (data) => toast.success(data.domain.status === "active" ? "Domain connected" : "Status checked", { description: data.domain.status === "active" ? "Published stores can now use this address." : "Still waiting for DNS, ownership verification or HTTPS." }))}><RefreshCw size={15} aria-hidden />{pending === domain.id ? "Checking…" : "Check connection"}</Button>
          {domain.status === "active" && <a className="button secondary" href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">Open store <ExternalLink size={14} aria-hidden /></a>}
          <Button type="button" className="button secondary" disabled={!!pending || !ready} onClick={() => setRemove(domain)}><Trash2 size={15} aria-hidden />Remove</Button>
        </div>
      </article>)}
    </section>
    <Dialog open={review} onOpenChange={(open) => { if (!pending) setReview(open); }}>
      <DialogContent className="domain-purchase-dialog">
        <DialogHeader><DialogTitle>Review domain purchase</DialogTitle><DialogDescription>Staging rehearsal. Your domain is not reserved and you will not be charged.</DialogDescription></DialogHeader>
        {quoted && <form onSubmit={(event) => { event.preventDefault(); void run("rehearse", { action: "rehearse", hostname: quote!.domain, expectedPrice: quote!.price }, (data) => { if (data.simulated && data.charged === false && data.registered === false) { setRehearsed(true); setReview(false); } }); }}>
          <dl className="domains-order"><div><dt>Domain</dt><dd>{quote!.domain}</dd></div><div><dt>Registration</dt><dd>{usd(quote!.price!)} / {quote!.years} {quote!.years === 1 ? "year" : "years"}</dd></div><div><dt>Renewal estimate</dt><dd>{usd(quote!.renewalPrice!)}</dd></div><div><dt>Charged today</dt><dd>$0.00 · Preview</dd></div></dl>
          <p>Live registration will require the registrant&apos;s contact details and a confirmed payment method. Neither is collected in this rehearsal.</p>
          <label className="domains-renew"><Checkbox checked={renew} onCheckedChange={(checked) => setRenew(checked === true)} />Automatically renew this domain (preview preference)</label>
          <p className="domains-footnote">Your renewal preference is demonstrated here only; no renewal setting is saved.</p>
          <DialogFooter><Button type="button" className="button secondary" disabled={!!pending} onClick={() => setReview(false)}>Back</Button><Button type="submit" className="button" disabled={!!pending}>{pending === "rehearse" ? "Checking price…" : "Complete purchase preview"}</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!remove} onOpenChange={(open) => { if (!open && !pending) setRemove(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {remove?.hostname}?</AlertDialogTitle><AlertDialogDescription>The store will use its platform link again. Domain registration and DNS records remain with your provider.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="button secondary" disabled={!!pending}>Keep domain</AlertDialogCancel><AlertDialogAction className="button danger" disabled={!!pending} onClick={() => { if (remove) void run("remove", { action: "remove", id: remove.id }, () => { setRemove(null); toast.success("Domain removed"); }); }}>Remove connection</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
