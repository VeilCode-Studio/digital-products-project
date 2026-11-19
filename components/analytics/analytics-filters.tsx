"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGES, type Filters, type KindFilter, type RangeKey } from "@/lib/analytics";

/** Wraps the filters and the report, dimming the report while new numbers load. */
export function AnalyticsFrame({ filters, products, children }: { filters: Filters; products: { id: string; name: string }[]; children: React.ReactNode }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const apply = (next: Partial<Filters>) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams({ range: merged.range });
    if (merged.range === "custom") { params.set("from", merged.from); params.set("to", merged.to); }
    if (merged.kind !== "all") params.set("kind", merged.kind);
    if (merged.product !== "all") params.set("product", merged.product);
    startTransition(() => router.push(`${pathname}?${params}`, { scroll: false }));
  };
  return <>
    <FilterBar key={`${filters.from}-${filters.to}`} filters={filters} products={products} onChange={apply} pending={pending} />
    <div className="an-report" data-pending={pending || undefined} aria-busy={pending || undefined}>{children}</div>
  </>;
}

function FilterBar({ filters, products, onChange, pending }: { filters: Filters; products: { id: string; name: string }[]; onChange: (next: Partial<Filters>) => void; pending: boolean }) {
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const today = new Date().toISOString().slice(0, 10);
  const rangeItems = Object.entries(RANGES).map(([value, label]) => ({ value, label }));
  const productItems = [{ value: "all", label: "All products" }, ...products.map((product) => ({ value: product.id, label: product.name }))];
  const kinds: { value: KindFilter; label: string }[] = [{ value: "all", label: "All" }, { value: "digital", label: "Digital" }, { value: "physical", label: "Physical" }];

  return <div className="an-filters" role="group" aria-label="Report filters">
    <div className="an-filter">
      <span className="an-filter-label" id="an-range-label">Period</span>
      <Select items={rangeItems} value={filters.range} onValueChange={(value) => {
        if (value === null) return;
        if (value === "custom") onChange({ range: "custom", from, to });
        else onChange({ range: value as RangeKey });
      }}>
        <SelectTrigger aria-labelledby="an-range-label" className="an-trigger"><SelectValue /></SelectTrigger>
        <SelectContent>{rangeItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>

    {filters.range === "custom" && <form className="an-dates" onSubmit={(event) => { event.preventDefault(); onChange({ range: "custom", from, to }); }}>
      <label className="an-filter"><span className="an-filter-label">From</span><input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} required /></label>
      <label className="an-filter"><span className="an-filter-label">To</span><input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} required /></label>
      <button type="submit" className="button secondary an-apply" disabled={pending || (from === filters.from && to === filters.to)}>Apply</button>
    </form>}

    <div className="an-filter">
      <span className="an-filter-label" id="an-kind-label">Type</span>
      <div className="an-segment" role="radiogroup" aria-labelledby="an-kind-label">
        {kinds.map((kind) => <button key={kind.value} type="button" role="radio" aria-checked={filters.kind === kind.value} className={filters.kind === kind.value ? "active" : ""} onClick={() => filters.kind !== kind.value && onChange({ kind: kind.value })}>{kind.label}</button>)}
      </div>
    </div>

    <div className="an-filter an-filter-grow">
      <span className="an-filter-label" id="an-product-label">Product</span>
      <Select items={productItems} value={filters.product} onValueChange={(value) => { if (value !== null) onChange({ product: String(value) }); }}>
        <SelectTrigger aria-labelledby="an-product-label" className="an-trigger an-trigger-wide"><SelectValue /></SelectTrigger>
        <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>

    {pending && <span className="an-loading" role="status">Updating…</span>}
  </div>;
}
