"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DOMAIN_COUNTRIES, DOMAIN_TERMS_URL } from "@/lib/domain-registration-terms";
import type { RegistrationContact } from "@/lib/domain-registration-contact";
import type { DomainQuote } from "@/lib/domain-types";

const countries = new Intl.DisplayNames(["en"], { type: "region" });
const usd = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const fields: { name: keyof RegistrationContact; label: string; autoComplete: string; optional?: boolean; type?: string; max: number }[] = [
  { name: "firstName", label: "First name", autoComplete: "given-name", max: 100 },
  { name: "lastName", label: "Last name", autoComplete: "family-name", max: 100 },
  { name: "email", label: "Email", autoComplete: "email", type: "email", max: 254 },
  { name: "phone", label: "Phone with country code", autoComplete: "tel", type: "tel", max: 16 },
  { name: "address1", label: "Street address", autoComplete: "address-line1", max: 200 },
  { name: "address2", label: "Apartment, suite, etc. (optional)", autoComplete: "address-line2", optional: true, max: 200 },
  { name: "city", label: "City", autoComplete: "address-level2", max: 100 },
  { name: "state", label: "State, province or region", autoComplete: "address-level1", max: 100 },
  { name: "zip", label: "Postal code", autoComplete: "postal-code", max: 30 },
  { name: "companyName", label: "Company (optional)", autoComplete: "organization", optional: true, max: 100 },
];
const emptyContact: RegistrationContact = { firstName: "", lastName: "", email: "", phone: "", address1: "", address2: "", city: "", state: "", zip: "", country: "", companyName: "" };

export function DomainRegistrationDialog({ quote, products, productId, sandbox, open, onOpenChange, requestId }: {
  quote: DomainQuote; products: { id: string; name: string }[]; productId: string; sandbox: boolean;
  open: boolean; onOpenChange: (open: boolean) => void; requestId: string;
}) {
  const [target, setTarget] = useState(productId);
  const [contact, setContact] = useState(emptyContact);
  const [renew, setRenew] = useState(false);
  const [consent, setConsent] = useState(false);
  const [scenario, setScenario] = useState("success");
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function checkout() {
    if (pending || !consent || !target || !contact.country) return;
    setPending(true); setLocked(true); setError("");
    try {
      const response = await fetch("/api/admin/domain-purchases", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, hostname: quote.domain, productId: target, expectedPrice: quote.price,
          expectedRenewalPrice: quote.renewalPrice, expectedYears: quote.years, renew, acceptTerms: consent, contact, simulationScenario: scenario }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Checkout could not be started. Please try again.");
      window.location.assign(result.url || `/admin/domains?purchase=${encodeURIComponent(result.purchaseId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be confirmed.");
      const check = await fetch(`/api/admin/domain-purchases?id=${requestId}`).catch(() => null);
      setSaved(check?.ok === true);
      if (check?.status === 404) setLocked(false);
      setPending(false);
    }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <DialogContent className="domain-purchase-dialog domain-registration-dialog" overlayClassName="domain-purchase-overlay">
      <DialogHeader className="domain-purchase-heading">
        <span className="domain-purchase-badge">{sandbox ? "Sandbox purchase" : "Domain registration"}</span>
        <DialogTitle>{quote.domain}</DialogTitle>
        <DialogDescription>{sandbox ? "Test payment and registration outcomes. No real money moves and no real domain is registered." : "Review the price and registrant details before paying securely through Stripe."}</DialogDescription>
      </DialogHeader>
      <form className="domain-purchase-form" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void checkout(); }}>
        <dl className="domain-purchase-prices domain-registration-quote">
          <div><dt>{quote.years}-year registration</dt><dd>{usd(quote.price!)}</dd></div>
          <div><dt>Renewal estimate for the same term</dt><dd>{usd(quote.renewalPrice!)}</dd></div>
        </dl>
        <div className="domain-registration-field"><label htmlFor="registration-product">Product or store</label>
          <Select value={target} onValueChange={(value) => setTarget(value ?? "")} disabled={locked}>
            <SelectTrigger id="registration-product"><SelectValue>{products.find((p) => p.id === target)?.name ?? "Choose a product or store"}</SelectValue></SelectTrigger>
            <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="domain-registration-title"><h3>Registrant details</h3>{sandbox && <Button type="button" variant="outline" disabled={locked} onClick={() => setContact({ firstName: "Domain", lastName: "Test", email: "domain-test@example.com", phone: "+14155550123", address1: "123 Test Street", address2: "", city: "San Francisco", state: "CA", zip: "94105", country: "US", companyName: "" })}>Use sample details</Button>}</div>
        <p className="domain-registration-help">{sandbox ? "Use sample contact details for this test." : "Use accurate details. The registrar uses these for ownership and verification; they are sent only when registration starts."} Phone example: +14155550123.</p>
        <div className="domain-registration-fields">
          {fields.map((field) => <div className="domain-registration-field" key={field.name}>
            <label htmlFor={`registrant-${field.name}`}>{field.label}</label>
            <Input id={`registrant-${field.name}`} type={field.type ?? "text"} autoComplete={field.autoComplete}
              required={!field.optional} maxLength={field.max} disabled={locked} value={contact[field.name]}
              pattern={field.name === "phone" ? "\\+[1-9][0-9]{6,14}" : undefined}
              onChange={(event) => setContact({ ...contact, [field.name]: event.target.value })} />
          </div>)}
          <div className="domain-registration-field"><label htmlFor="registrant-country">Country</label>
            <Select value={contact.country} onValueChange={(value) => setContact({ ...contact, country: value ?? "" })} disabled={locked}>
              <SelectTrigger id="registrant-country"><SelectValue>{contact.country ? countries.of(contact.country) : "Choose a country"}</SelectValue></SelectTrigger>
              <SelectContent>{DOMAIN_COUNTRIES.map((code) => <SelectItem key={code} value={code}>{countries.of(code)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {sandbox && <div className="domain-registration-field"><label htmlFor="registration-scenario">After successful test payment</label>
          <Select value={scenario} onValueChange={(value) => setScenario(value ?? "success")} disabled={locked}>
            <SelectTrigger id="registration-scenario"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="success">Registration succeeds</SelectItem><SelectItem value="failure">Registration fails → refund payment</SelectItem><SelectItem value="uncertain">Registrar times out → needs review</SelectItem></SelectContent>
          </Select>
        </div>}
        <label className="domain-purchase-renew"><Checkbox checked={renew} disabled={locked} onCheckedChange={(value) => setRenew(value === true)} /><span><strong>Automatic renewal</strong><span>{sandbox ? "Test preference only; no renewal is scheduled." : "Renew with the registrar before expiry. Future renewal prices may change."}</span></span></label>
        <label className="domain-purchase-renew"><Checkbox checked={consent} disabled={locked} onCheckedChange={(value) => setConsent(value === true)} /><span><strong>{sandbox ? "I understand this is a sandbox test." : "I authorize this purchase and accept the registration terms."}</strong><span>{sandbox ? "Stripe test cards only. The registration outcome is simulated." : <>Successful registrations are non-refundable. If registration fails, the payment is refunded. Read the <a href={DOMAIN_TERMS_URL} target="_blank" rel="noopener noreferrer">registration terms</a>.</>}</span></span></label>
        {error && <p className="domain-purchase-error" role="alert">{error}{saved && <> <a href={`/admin/domains?purchase=${requestId}`}>Check purchase status</a>.</>}</p>}
        <DialogFooter className="domain-purchase-footer"><Button type="button" className="button secondary" disabled={pending} onClick={() => onOpenChange(false)}>Back</Button><Button type="submit" className="button" disabled={pending || !consent || !target || !contact.country}>{pending ? "Preparing checkout…" : `${sandbox ? "Test payment" : "Continue to payment"} · ${usd(quote.price!)}`}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
