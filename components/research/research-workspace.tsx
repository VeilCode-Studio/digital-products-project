"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Clock3, Copy, Layers, Loader2, Plus, Search, Store, TrendingUp, Users } from "lucide-react";
import {
  longestRunning, META_MEDIA, META_MIN_DAYS, STAGE_HINTS, STAGE_LABELS, STAGES, unitEconomics,
  type CjProduct, type MetaAd, type MetaFilters, type MetaSearch, type ResearchCard, type ResearchProduct,
} from "@/lib/research.types";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dollars, metaLibraryUrl, researchApi } from "./api";
import { ResearchDrawer } from "./research-drawer";

type Tab = "meta" | "cj" | "manual";
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Other free places to check the same idea, opened in a new tab. */
const elsewhere = (query: string) => [
  { label: "Meta Ad Library (US)", href: metaLibraryUrl(query) },
  { label: "TikTok", href: `https://www.tiktok.com/search?q=${encodeURIComponent(query)}` },
  { label: "Google Trends", href: `https://trends.google.com/trends/explore?${new URLSearchParams({ geo: "US", q: query })}` },
  { label: "Amazon", href: `https://www.amazon.com/s?${new URLSearchParams({ k: query })}` },
];

/** How the Meta results are narrowed. Days and media go to Meta with the search; the rest sort the results here. */
type AdFilters = Required<MetaFilters> & { minVersions: 1 | 3 | 5; collapse: boolean; sort: "signal" | "days" | "reach" };
const DEFAULT_FILTERS: AdFilters = { minDays: 0, media: "ALL", minVersions: 1, collapse: true, sort: "signal" };
const FILTERS_KEY = "veilcode:research-ad-filters";
type Option<T> = { value: T; label: string };
const DAY_OPTIONS: Option<AdFilters["minDays"]>[] = META_MIN_DAYS.map((days) => ({ value: days, label: days === 0 ? "Any time" : `${days}+ days` }));
const MEDIA_OPTIONS: Option<AdFilters["media"]>[] = META_MEDIA.map((media) => ({ value: media, label: { ALL: "Any media", VIDEO: "Video", IMAGE: "Image" }[media] }));
const VERSION_OPTIONS: Option<AdFilters["minVersions"]>[] = [{ value: 1, label: "Any" }, { value: 3, label: "3+" }, { value: 5, label: "5+" }];
const SORT_OPTIONS: Option<AdFilters["sort"]>[] = [{ value: "signal", label: "Strongest signal" }, { value: "days", label: "Longest running" }, { value: "reach", label: "Most reach" }];

/** A labelled shadcn Select for one filter. */
function FilterSelect<T extends string | number>({ id, label, value, options, onChange }: {
  id: string; label: string; value: T; options: Option<T>[]; onChange: (value: T) => void;
}) {
  return <div className="research-filter">
    <span id={`${id}-label`} className="research-filter-label">{label}</span>
    <Select items={options} value={value} onValueChange={(next) => { if (next !== null) onChange(next as T); }}>
      <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="research-filter-trigger"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={String(option.value)} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}

function readFilters(): AdFilters {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") as Partial<AdFilters>;
    return {
      minDays: (META_MIN_DAYS as readonly unknown[]).includes(saved.minDays) ? saved.minDays! : DEFAULT_FILTERS.minDays,
      media: (META_MEDIA as readonly unknown[]).includes(saved.media) ? saved.media! : DEFAULT_FILTERS.media,
      minVersions: ([1, 3, 5] as unknown[]).includes(saved.minVersions) ? saved.minVersions! : DEFAULT_FILTERS.minVersions,
      collapse: typeof saved.collapse === "boolean" ? saved.collapse : DEFAULT_FILTERS.collapse,
      sort: (["signal", "days", "reach"] as unknown[]).includes(saved.sort) ? saved.sort! : DEFAULT_FILTERS.sort,
    };
  } catch { return DEFAULT_FILTERS; }
}

/** One card per ad text when `collapse` is on: copies on other pages add to its versions and reach. */
function visibleAds(ads: MetaAd[], filters: AdFilters) {
  let list = ads;
  if (filters.collapse) {
    const groups = new Map<string, MetaAd>();
    for (const ad of ads) {
      const lead = groups.get(ad.copyKey);
      if (!lead) groups.set(ad.copyKey, ad);
      else {
        const better = (ad.daysRunning ?? 0) > (lead.daysRunning ?? 0) ? ad : lead;
        groups.set(ad.copyKey, { ...better, versions: lead.versions + ad.versions, reach: (lead.reach ?? 0) + (ad.reach ?? 0) || null });
      }
    }
    list = [...groups.values()];
  }
  const score = (ad: MetaAd) => filters.sort === "days" ? ad.daysRunning ?? 0
    : filters.sort === "reach" ? ad.reach ?? -1
    // Long-running ads with many versions, run from several pages: the usual signs of a profitable ad.
    : (ad.daysRunning ?? 0) * Math.min(ad.versions, 5) * Math.min(ad.pages, 3) + ad.versions;
  return list.filter((ad) => ad.versions >= filters.minVersions).sort((a, b) => score(b) - score(a));
}

export function ResearchWorkspace({ initialItems, meta, cj }: { initialItems: ResearchCard[]; meta: boolean; cj: boolean }) {
  const [items, setItems] = useState(initialItems);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(meta ? "meta" : cj ? "cj" : "manual");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [metaResult, setMetaResult] = useState<MetaSearch | null>(null);
  const [filters, setFilters] = useState<AdFilters>(DEFAULT_FILTERS);
  const [cjResult, setCjResult] = useState<CjProduct[] | null>(null);
  const [manual, setManual] = useState<{ title: string; url: string; kind: "physical" | "digital" }>({ title: "", url: "", kind: "physical" });

  // The last filters used in this browser. localStorage is only readable after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setFilters(readFilters()); }, []);
  const ads = useMemo(() => metaResult?.status === "ok" ? visibleAds(metaResult.ads, filters) : [], [metaResult, filters]);

  const byStage = useMemo(() => Object.fromEntries(STAGES.map((stage) => [stage, items.filter((item) => item.stage === stage)])), [items]);
  const open = items.find((item) => item.id === openId) ?? null;

  /** Merges a saved idea back into the board, keeping the store link the server listed. */
  function upsert(item: ResearchProduct, store?: ResearchCard["store"]) {
    setItems((current) => {
      const existing = current.find((entry) => entry.id === item.id);
      const card: ResearchCard = { ...item, store: store !== undefined ? store : existing?.store ?? null };
      return existing ? current.map((entry) => (entry.id === item.id ? card : entry)) : [card, ...current];
    });
  }

  async function run(key: string, task: () => Promise<void>) {
    setPending(key); setError("");
    try { await task(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Something went wrong."); } finally { setPending(null); }
  }

  function searchMeta(terms: string, using: AdFilters) {
    void run("search", async () => {
      setMetaResult(await researchApi<MetaSearch>({ action: "meta-search", query: terms, filters: { minDays: using.minDays, media: using.media } }));
    });
  }

  /** Changes a filter. Days and media are applied by Meta, so they search again. */
  function filter(change: Partial<AdFilters>) {
    const next = { ...filters, ...change };
    setFilters(next);
    try { localStorage.setItem(FILTERS_KEY, JSON.stringify(next)); } catch { /* Not remembered; the filter still applies now. */ }
    if (searched && tab === "meta" && ("minDays" in change || "media" in change)) searchMeta(searched, next);
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    const terms = query.trim();
    if (terms.length < 2) return;
    setSearched(terms);
    if (tab === "meta") searchMeta(terms, filters);
    if (tab === "cj") void run("search", async () => { setCjResult((await researchApi<{ products: CjProduct[] }>({ action: "cj-search", query: terms })).products); });
  }

  /** Adds a Meta ad to the idea named like the search, or starts that idea. */
  function saveAd(ad: MetaAd) {
    const title = searched.charAt(0).toUpperCase() + searched.slice(1);
    const entry = { id: ad.id, url: ad.url, page: ad.page, startedAt: ad.startedAt, source: "meta", note: [ad.title, ad.versions > 1 ? `${ad.versions} versions` : ""].filter(Boolean).join(" · ").slice(0, 300) };
    const existing = items.find((item) => item.title.toLowerCase() === title.toLowerCase());
    void run(`ad:${ad.id}`, async () => {
      if (existing) {
        if (existing.ads.some((saved) => saved.id === ad.id)) return;
        if (existing.ads.length >= 20) throw new Error(`“${existing.title}” already has 20 ads. Remove one first.`);
        upsert((await researchApi<{ item: ResearchProduct }>({ action: "update", id: existing.id, ads: [...existing.ads, entry] })).item);
      } else {
        upsert((await researchApi<{ item: ResearchProduct }>({ action: "create", title, ads: [entry] })).item);
      }
    });
  }

  function saveCj(product: CjProduct) {
    void run(`cj:${product.id}`, async () => {
      const { supplier } = await researchApi<{ supplier: ResearchProduct["supplier"] & { image: string | null } }>({ action: "cj-detail", pid: product.id });
      const { image, ...details } = supplier!;
      const { item } = await researchApi<{ item: ResearchProduct }>({
        action: "create", title: product.name.slice(0, 120), image_url: image ?? product.image, supplier: { ...details, url: details.url ?? product.url },
        notes: product.listed ? `Listed by ${product.listed.toLocaleString("en-US")} stores on CJ.` : "",
      });
      upsert(item); setOpenId(item.id);
    });
  }

  function saveManual(event: React.FormEvent) {
    event.preventDefault();
    void run("manual", async () => {
      const ads = manual.url.trim() ? [{ url: manual.url.trim(), page: "", startedAt: null, source: "manual", note: "" }] : [];
      const { item } = await researchApi<{ item: ResearchProduct }>({ action: "create", title: manual.title, kind: manual.kind, ads });
      upsert(item); setManual({ title: "", url: "", kind: manual.kind }); setOpenId(item.id);
    });
  }

  const savedAdIds = useMemo(() => new Set(items.flatMap((item) => item.ads.map((ad) => ad.id))), [items]);

  return <div className="research">
    <section className="workspace-panel research-finder" aria-labelledby="finder-title">
      <div className="panel-heading">
        <div><h2 id="finder-title">Find products</h2><p>Search what&apos;s advertising and what suppliers stock, then save the promising ones.</p></div>
      </div>
      <div className="research-tabs" role="tablist" aria-label="Where to search">
        {([["meta", "Meta ads · UK & EU"], ["cj", "CJ suppliers"], ["manual", "Add your own"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setError(""); }}>{label}</button>
        ))}
      </div>

      {tab !== "manual" ? <form className="research-search" onSubmit={search}>
        <label className="research-search-field"><span className="sr-only">Search</span>
          <Search size={17} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder={tab === "meta" ? "Try “posture corrector” or “pet hair remover”" : "Search CJ's catalogue, e.g. “led strip lights”"} />
        </label>
        <button className="button primary" disabled={pending === "search" || query.trim().length < 2}>{pending === "search" ? <Loader2 className="spin" size={16} /> : <Search size={16} />} Search</button>
      </form> : <form className="research-manual" onSubmit={saveManual}>
        <div className="research-kind" role="radiogroup" aria-label="Kind of product">
          {(["physical", "digital"] as const).map((kind) => <button key={kind} type="button" role="radio" aria-checked={manual.kind === kind} className={manual.kind === kind ? "active" : ""} onClick={() => setManual({ ...manual, kind })}>{kind === "physical" ? "Physical" : "Digital"}</button>)}
        </div>
        <label>Product<input value={manual.title} onChange={(event) => setManual({ ...manual, title: event.target.value })} maxLength={120} required placeholder={manual.kind === "digital" ? "e.g. Client onboarding template pack" : "e.g. Heated eye massager"} /></label>
        <label>Ad or product link <span className="optional">optional</span><input value={manual.url} onChange={(event) => setManual({ ...manual, url: event.target.value })} type="url" placeholder="https://…" /></label>
        <button className="button primary" disabled={pending === "manual" || !manual.title.trim()}><Plus size={16} /> Save to board</button>
      </form>}

      {tab === "meta" && meta && <div className="research-filters" role="group" aria-label="Filter ads">
        <FilterSelect id="ad-days" label="Running" value={filters.minDays} options={DAY_OPTIONS} onChange={(minDays) => filter({ minDays })} />
        <FilterSelect id="ad-media" label="Media" value={filters.media} options={MEDIA_OPTIONS} onChange={(media) => filter({ media })} />
        <FilterSelect id="ad-versions" label="Versions" value={filters.minVersions} options={VERSION_OPTIONS} onChange={(minVersions) => filter({ minVersions })} />
        <FilterSelect id="ad-sort" label="Sort" value={filters.sort} options={SORT_OPTIONS} onChange={(sort) => filter({ sort })} />
        <label className="research-filter-check">
          <Checkbox checked={filters.collapse} onCheckedChange={(collapse) => filter({ collapse })} className="research-checkbox" />
          Group copycat pages
        </label>
      </div>}

      {error && <p className="form-error" role="alert">{error}</p>}
      {tab === "meta" && !meta && <p className="research-note">Meta search needs <code>META_ACCESS_TOKEN</code> in this environment. You can still open Meta&apos;s Ad Library below.</p>}
      {tab === "cj" && !cj && <p className="research-note">CJ search needs <code>CJ_API_KEY</code> in this environment.</p>}

      {searched && tab !== "manual" && <div className="research-elsewhere">
        <span>Also check “{searched}” on</span>
        {elsewhere(searched).map((place) => <a key={place.label} href={place.href} target="_blank" rel="noopener noreferrer">{place.label} <ArrowUpRight size={13} /></a>)}
      </div>}

      {tab === "meta" && metaResult && (metaResult.status !== "ok"
        ? <div className="research-note warn" role="status">{metaResult.message} Meaning to look at US ads? Use “Meta Ad Library (US)” above, or ask Claude to search and save them for you.</div>
        : metaResult.ads.length === 0
          ? <p className="research-note">No active UK or EU ads matched{filters.minDays || filters.media !== "ALL" ? " these filters" : ""}. Try a broader phrase{filters.minDays || filters.media !== "ALL" ? " or fewer filters" : ""}.</p>
          : ads.length === 0
            ? <p className="research-note">None of the {metaResult.ads.length} ads found has {filters.minVersions}+ versions. Lower the Versions filter.</p>
            : <>
          <p className="research-count">Showing {Math.min(ads.length, 30)} of {ads.length}{ads.length !== metaResult.ads.length ? ` (grouped from ${metaResult.ads.length} ads)` : ""}{filters.minDays ? `, all running ${filters.minDays}+ days` : ""}.</p>
          <div className="research-results">{ads.slice(0, 30).map((ad) => (
            <article key={ad.id} className="research-ad">
              <header><strong>{ad.page}</strong>{ad.platforms.length > 0 && <span>{ad.platforms.map((platform) => platform.toLowerCase()).join(" · ")}</span>}</header>
              <div className="research-signals">
                {ad.daysRunning !== null && <span className={ad.daysRunning >= 30 ? "signal strong" : "signal"}><Clock3 size={13} /> {ad.daysRunning} days</span>}
                {ad.versions > 1 && <span className={ad.versions >= 3 ? "signal strong" : "signal"}><Copy size={13} /> {ad.versions} versions</span>}
                {ad.pages > 1 && <span className="signal strong" title="Different pages run this same text, usually one seller testing at scale."><Users size={13} /> {ad.pages} pages</span>}
                {ad.reach !== null && <span className="signal"><TrendingUp size={13} /> {compact.format(ad.reach)} reached</span>}
              </div>
              {ad.title && <p className="research-ad-title">{ad.title}</p>}
              {ad.text && <p className="research-ad-text">{ad.text}</p>}
              <footer>
                <a href={ad.url} target="_blank" rel="noopener noreferrer">See ad on Meta <ArrowUpRight size={13} /></a>
                <button type="button" className="button secondary small" disabled={pending === `ad:${ad.id}` || savedAdIds.has(ad.id)} onClick={() => saveAd(ad)}>
                  {savedAdIds.has(ad.id) ? "Saved" : pending === `ad:${ad.id}` ? "Saving…" : <><Plus size={14} /> Save</>}
                </button>
              </footer>
            </article>
          ))}</div>
        </>)}

      {tab === "cj" && cjResult && (cjResult.length === 0
        ? <p className="research-note">CJ has nothing for that search. Try simpler words.</p>
        : <div className="research-results">{cjResult.map((product) => (
          <article key={product.id} className="research-cj">
            {product.image
              // eslint-disable-next-line @next/next/no-img-element -- supplier images come from CJ's CDN; not worth routing through the optimiser
              ? <img src={product.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
              : <div className="research-cj-blank" aria-hidden="true" />}
            <div>
              <p className="research-ad-title">{product.name}</p>
              <div className="research-signals">
                {product.cost !== null && <span className="signal">from {dollars(product.cost)}</span>}
                {product.listed !== null && product.listed > 0 && <span className={product.listed >= 200 ? "signal strong" : "signal"}><Store size={13} /> {compact.format(product.listed)} stores</span>}
              </div>
            </div>
            <footer>
              <a href={product.url} target="_blank" rel="noopener noreferrer">On CJ <ArrowUpRight size={13} /></a>
              <button type="button" className="button secondary small" disabled={pending === `cj:${product.id}`} onClick={() => saveCj(product)}>
                {pending === `cj:${product.id}` ? "Getting costs…" : <><Plus size={14} /> Save</>}
              </button>
            </footer>
          </article>
        ))}</div>)}
    </section>

    <section className="research-board" aria-label="Research board">
      {STAGES.map((stage) => (
        <div key={stage} className={`research-column stage-${stage}`}>
          <header><h2>{STAGE_LABELS[stage]}</h2><span>{byStage[stage].length}</span><p>{STAGE_HINTS[stage]}</p></header>
          <div className="research-cards">
            {byStage[stage].length === 0 && <p className="research-empty">{stage === "saved" ? "Save a product from the search above." : "Nothing here yet."}</p>}
            {byStage[stage].map((item) => {
              const economics = unitEconomics(item);
              const days = longestRunning(item.ads);
              return <button key={item.id} type="button" className="research-card" onClick={() => setOpenId(item.id)}>
                {item.image_url
                  // eslint-disable-next-line @next/next/no-img-element -- owner-supplied or CJ image, shown small
                  ? <img src={item.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  : null}
                <strong>{item.title}</strong>
                <span className="research-signals">
                  {item.kind === "digital" && <span className="signal digital">Digital</span>}
                  {days !== null && <span className={days >= 30 ? "signal strong" : "signal"}><Clock3 size={12} /> {days}d</span>}
                  {item.ads.length > 0 && <span className="signal"><Layers size={12} /> {item.ads.length} {item.ads.length === 1 ? "ad" : "ads"}</span>}
                  {economics && <span className={economics.margin >= 0.3 ? "signal good" : economics.margin < 0.15 ? "signal bad" : "signal"}>{Math.round(economics.margin * 100)}% margin</span>}
                  {item.store && <span className="signal store"><Store size={12} /> {item.store.status === "published" ? "Live" : "Draft"} {item.store.kind === "digital" ? "product" : "store"}</span>}
                </span>
              </button>;
            })}
          </div>
        </div>
      ))}
    </section>

    {open && <ResearchDrawer key={open.id} item={open} onClose={() => setOpenId(null)} onSaved={upsert}
      onDeleted={(id) => { setItems((current) => current.filter((item) => item.id !== id)); setOpenId(null); }} cj={cj} />}
  </div>;
}
