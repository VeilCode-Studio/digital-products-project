"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ArrowUpRight, Check, CircleAlert, Copy, EyeOff, Globe, History, RefreshCw, Rocket, Smartphone, Sparkles, Store } from "lucide-react";
import { STORE_ID } from "@/lib/store-config";
import type { StoreEditorData } from "@/lib/manage-stores";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { MediaLibrary, MediaProvider } from "./media";
import { PageBuilder } from "./page-builder";
import { ProductTab } from "./product-tab";
import { BrandTab } from "./brand-tab";
import { ShippingTab } from "./shipping-tab";
import { PoliciesTab } from "./policies-tab";
import { publishProblems, saveProblems, saveRequest, toDraft, type Draft, type Problem, type TabId } from "./draft";

const TABS: { id: TabId; label: string }[] = [
  { id: "product", label: "Product" }, { id: "page", label: "Page" }, { id: "brand", label: "Brand" },
  { id: "shipping", label: "Shipping" }, { id: "policies", label: "Policies" }, { id: "media", label: "Media" }, { id: "publish", label: "Publish" },
];
const CHECKS: { tab: TabId; label: string }[] = [
  { tab: "page", label: "A hero with at least one product image" },
  { tab: "product", label: "At least one variant for sale, with a price" },
  { tab: "shipping", label: "An active US shipping rate" },
  { tab: "brand", label: "A support email" },
  { tab: "policies", label: "Store policies completed" },
];

type SaveError = { text: string; conflict: boolean; signIn?: boolean };
/** An unsaved draft kept in this browser, so a crash or closed tab doesn't lose work. */
type Backup = { revision: number; savedAt: number; draft: Draft };
const backupKey = (productId: string) => `veilcode:store-draft:${productId}`;
function readBackup(productId: string): Backup | null {
  try {
    const raw = localStorage.getItem(backupKey(productId));
    const backup = raw ? JSON.parse(raw) as Backup : null;
    return backup && typeof backup.revision === "number" && backup.draft && typeof backup.draft === "object" ? backup : null;
  } catch { return null; }
}
function writeBackup(productId: string, backup: Backup | null) {
  try {
    if (backup) localStorage.setItem(backupKey(productId), JSON.stringify(backup));
    else localStorage.removeItem(backupKey(productId));
  } catch { /* Private browsing or a full quota: the editor still works, just without the backup. */ }
}
const backupTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function ConfirmDialog({ open, onOpenChange, title, description, confirm, onConfirm, pending, icon }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; confirm: string; onConfirm: () => void; pending?: boolean; icon: React.ReactNode;
}) {
  return <AlertDialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <AlertDialogContent className="confirm-dialog">
      <span className="confirm-dialog-icon danger">{icon}</span>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="button secondary" disabled={pending}>Keep editing</AlertDialogCancel>
        <AlertDialogAction type="button" className="button danger" disabled={pending} onClick={onConfirm}>{confirm}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

export function StoreEditor({ data }: { data: StoreEditorData }) {
  const productId = data.product.id;
  const [baseline, setBaseline] = useState<Draft>(() => toDraft(data));
  const [draft, setDraft] = useState<Draft>(baseline);
  const [revision, setRevision] = useState(data.product.revision);
  const [saved, setSaved] = useState({ slug: data.product.slug, status: data.product.status });
  const [tab, setTab] = useState<TabId>("product");
  const [saving, setSaving] = useState<"save" | "publish" | "unpublish" | null>(null);
  const [error, setError] = useState<SaveError | null>(null);
  const [reveal, setReveal] = useState<{ section: number; at: number } | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [confirm, setConfirm] = useState<"discard" | "unpublish" | null>(null);
  const [restorable, setRestorable] = useState<Backup | null>(null);
  // The phone preview shows the saved store, or once the owner edits, their unsaved draft.
  const [livePreview, setLivePreview] = useState<{ version: number; state: "idle" | "sending" | "blocked" }>({ version: 0, state: "idle" });
  const heading = useRef<HTMLDivElement>(null);

  const update = useCallback((change: (draft: Draft) => Draft) => setDraft(change), []);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const changedProfiles = useMemo(() => draft.profiles.filter((profile) => {
    const before = baseline.profiles.find((entry) => entry.id === profile.id);
    return !before || JSON.stringify(before) !== JSON.stringify(profile);
  }), [draft.profiles, baseline.profiles]);
  const problems = useMemo(() => saveProblems(draft, STORE_ID, productId, changedProfiles), [draft, productId, changedProfiles]);
  const readiness = useMemo(() => publishProblems(draft, STORE_ID, productId), [draft, productId]);
  const pageProblem = problems.find((problem) => problem.tab === "page") ?? null;
  const usage = useMemo(() => JSON.stringify([draft.page, draft.brand.logoPath, draft.variants.map((variant) => variant.image)]), [draft.page, draft.brand.logoPath, draft.variants]);
  const used = useCallback((path: string) => usage.includes(JSON.stringify(path)), [usage]);
  const published = saved.status === "published";

  // Open the tab named in the address (#page), and keep it there as tabs change.
  useEffect(() => {
    const requested = window.location.hash.slice(1) as TabId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the hash is only readable after hydration
    if (TABS.some((entry) => entry.id === requested)) setTab(requested);
  }, []);
  const choose = (next: TabId) => { setTab(next); window.history.replaceState(null, "", `#${next}`); };

  // Offer to bring back a draft this browser kept from an earlier visit.
  useEffect(() => {
    const backup = readBackup(productId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    if (backup && JSON.stringify(backup.draft) !== JSON.stringify(baseline)) setRestorable(backup);
    else writeBackup(productId, null);
  // Only on first load: later saves and discards clear the backup themselves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Keep the backup current while there are unsaved changes, and drop it once there are none.
  useEffect(() => {
    if (restorable) return;
    const id = window.setTimeout(() => writeBackup(productId, dirty ? { revision, savedAt: Date.now(), draft } : null), 600);
    return () => window.clearTimeout(id);
  }, [draft, dirty, revision, productId, restorable]);

  // Live preview: a moment after the owner stops editing, send the draft and reload the phone preview.
  useEffect(() => {
    if (!dirty) return;
    // A draft that wouldn't save isn't sent; the note under the preview says why (derived below).
    if (problems.length) return;
    const controller = new AbortController();
    const id = window.setTimeout(async () => {
      setLivePreview((current) => ({ ...current, state: "sending" }));
      try {
        const body = { ...saveRequest(draft, productId, revision, [], draft.status), action: "preview" };
        const response = await fetch("/api/admin/stores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
        setLivePreview((current) => ({ version: response.ok ? current.version + 1 : current.version, state: response.ok ? "idle" : "blocked" }));
      } catch { if (!controller.signal.aborted) setLivePreview((current) => ({ ...current, state: "blocked" })); }
    }, 900);
    return () => { window.clearTimeout(id); controller.abort(); };
  }, [draft, dirty, problems.length, productId, revision]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const showProblem = useCallback((problem: Problem) => {
    setError({ text: problem.text, conflict: false });
    setTab(problem.tab); window.history.replaceState(null, "", `#${problem.tab}`);
    if (problem.section !== undefined && problem.section >= 0) setReveal({ section: problem.section, at: Date.now() });
  }, []);

  const save = useCallback(async (status: Draft["status"] = draft.status) => {
    if (saving) return false;
    if (problems.length) { showProblem(problems[0]); return false; }
    const sent = { ...draft, status };
    setSaving(status === draft.status ? "save" : status === "published" ? "publish" : "unpublish");
    setError(null);
    try {
      const response = await fetch("/api/admin/stores", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saveRequest(sent, productId, revision, changedProfiles, status)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(response.status === 401
          ? { text: "You've been signed out. Sign in again in a new tab, then come back and save: your changes are still here.", conflict: false, signIn: true }
          : { text: result.error || "Couldn't save. Your changes are still here; please try again.", conflict: response.status === 409 && /another tab|elsewhere/.test(result.error ?? "") });
        heading.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return false;
      }
      setBaseline(sent);
      writeBackup(productId, null);
      setDraft((current) => ({ ...current, status }));
      setRevision(result.revision);
      setSaved({ slug: result.slug, status });
      setPreviewVersion((version) => version + 1);
      toast.success(status === "published" && saved.status !== "published" ? "Your store is live" : status === "draft" && saved.status === "published" ? "Store unpublished" : "Store saved",
        { description: status === "published" ? `Visitors see these changes at /s/${result.slug}.` : "Only you can see this draft." });
      return true;
    } catch {
      setError({ text: "Couldn't reach the server. Check your connection; your changes are still here.", conflict: false });
      return false;
    } finally { setSaving(null); }
  }, [saving, problems, draft, productId, revision, changedProfiles, saved.status, showProblem]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (dirty) void save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, save]);

  const previewPath = `/s/${saved.slug}?preview=1`;
  const framePath = dirty && livePreview.version > 0 ? `${previewPath}&draft=1&v=${livePreview.version}` : `${previewPath}&v=${previewVersion}`;
  const tabHasProblem = (id: TabId) => problems.some((problem) => problem.tab === id);
  const ready = !readiness.length && !problems.length;

  // The first variant linked to a CJ product page: the media library can import that product's photos.
  const cjUrl = draft.variants.find((variant) => /^https:\/\/([a-z0-9-]+\.)*cjdropshipping\.com\//i.test(variant.supplierUrl))?.supplierUrl ?? null;
  return <MediaProvider productId={productId} mediaBase={data.mediaBase} initial={data.media} used={used} cjUrl={cjUrl}>
    <div className="se">
      <Link href="/admin/stores" className="back-link se-back"><ArrowLeft size={15} aria-hidden /> All stores</Link>
      <div className="se-head" ref={heading}>
        <div className="se-head-title">
          <span className="se-head-icon"><Store size={20} aria-hidden /></span>
          <div>
            <h1>{draft.name || "Untitled store"} <span className={`badge ${published ? "published" : "draft"}`}>{published ? "Live" : "Draft"}</span></h1>
            <a href={previewPath} target="_blank" rel="noopener noreferrer" className="se-head-url">/s/{saved.slug}<ArrowUpRight size={13} aria-hidden /></a>
          </div>
        </div>
        <div className="se-head-actions">
          <a className="button secondary small" href={previewPath} target="_blank" rel="noopener noreferrer"><Smartphone size={15} aria-hidden />Preview</a>
          <button type="button" className="button primary small" disabled={!dirty || !!saving} onClick={() => save()}>{saving === "save" ? "Saving…" : dirty ? "Save" : <><Check size={15} aria-hidden />Saved</>}</button>
        </div>
      </div>

      <nav className="se-tabs" aria-label="Store editor">
        {TABS.map((entry) => <button key={entry.id} type="button" aria-current={tab === entry.id ? "page" : undefined} className={tab === entry.id ? "is-active" : ""} onClick={() => choose(entry.id)}>
          {entry.label}
          {tabHasProblem(entry.id) && <span className="se-dot" aria-label="needs attention" />}
          {entry.id === "publish" && !published && <span className="se-tab-count" aria-label={`${readiness.length} to do`}>{readiness.length || <Check size={11} aria-hidden />}</span>}
        </button>)}
      </nav>

      {restorable && <div className="se-restore" role="status">
        <History size={16} aria-hidden />
        <span>Unsaved changes from {backupTime.format(new Date(restorable.savedAt))} were kept in this browser.{restorable.revision !== revision ? " The store has been saved since, so restoring brings back your older edits." : ""}</span>
        <button type="button" className="button primary small" onClick={() => { setDraft(restorable.draft); setRestorable(null); toast.success("Changes restored", { description: "Review them, then save." }); }}>Restore</button>
        <button type="button" className="button secondary small" onClick={() => { writeBackup(productId, null); setRestorable(null); }}>Dismiss</button>
      </div>}
      {data.pageProblem && <p className="form-error" role="alert">The saved page had a problem ({data.pageProblem}). Fix it on the Page tab; saving replaces the page.</p>}
      {error && <div className="form-error se-error" role="alert"><CircleAlert size={16} aria-hidden /><span>{error.text}</span>
        {error.conflict && <button type="button" className="button secondary small" onClick={() => window.location.reload()}><RefreshCw size={14} aria-hidden />Reload</button>}
        {error.signIn && <a className="button secondary small" href="/admin/login" target="_blank" rel="noopener">Sign in in a new tab<ArrowUpRight size={14} aria-hidden /></a>}</div>}

      <div className="se-body">
        <div className="se-main">
          {tab === "product" && <ProductTab draft={draft} update={update} published={published} savedSlug={saved.slug} />}
          {tab === "page" && <section className="workspace-panel form-panel">
            <div className="form-section-heading"><span className="step-number">01</span><div><h2>Store page</h2><p>Sections from top to bottom. Open one to edit it; switch it off to hide it without losing it.</p></div></div>
            <PageBuilder page={draft.page} problem={pageProblem ? { section: pageProblem.section ?? -1, text: pageProblem.text } : null} reveal={reveal}
              onChange={(change) => update((current) => ({ ...current, page: change(current.page) }))} />
          </section>}
          {tab === "brand" && <BrandTab draft={draft} update={update} serverPixels={data.tiktokServerPixels} metaServerPixels={data.metaServerPixels} />}
          {tab === "shipping" && <ShippingTab draft={draft} update={update} />}
          {tab === "policies" && <PoliciesTab draft={draft} update={update} previewBase={`/s/${saved.slug}`} />}
          {tab === "media" && <section className="workspace-panel form-panel">
            <div className="form-section-heading"><span className="step-number">01</span><div><h2>Media</h2><p>Every image, GIF and video for this store. Videos get a poster frame automatically.</p></div></div>
            <MediaLibrary />
          </section>}
          {tab === "publish" && <section className="workspace-panel form-panel">
            <div className="form-section-heading"><span className="step-number"><Rocket size={15} aria-hidden /></span><div><h2>{published ? "Your store is live" : "Publish your store"}</h2><p>{published ? "Saved changes go live straight away." : "Everything below must be in place before the store can take payments."}</p></div></div>
            <ul className="se-checklist">
              {CHECKS.map((check) => {
                const missing = readiness.filter((problem) => problem.tab === check.tab);
                return <li key={check.tab} className={missing.length ? "is-missing" : "is-done"}>
                  <span className="se-check-mark" aria-hidden>{missing.length ? "" : <Check size={13} />}</span>
                  <div>
                    <strong>{check.label}<span className="sr-only">{missing.length ? ": missing" : ": done"}</span></strong>
                    {missing.map((problem) => <span key={problem.text} className="field-help">{problem.text}</span>)}
                  </div>
                  {missing.length > 0 && <button type="button" className="se-text-button" onClick={() => choose(check.tab)}>Fix</button>}
                </li>;
              })}
            </ul>
            {problems.length > 0 && <p className="form-error">{problems.length === 1 ? "One thing" : `${problems.length} things`} need fixing before you can save: {problems[0].text} <button type="button" className="se-text-button" onClick={() => showProblem(problems[0])}>Show me</button></p>}
            {published ? <div className="se-live">
              <p><Globe size={16} aria-hidden /><span>Live at <a href={`/s/${saved.slug}`} target="_blank" rel="noopener noreferrer">{typeof window === "undefined" ? "" : window.location.host}/s/{saved.slug}</a></span>
                <button type="button" className="se-text-button" onClick={async () => { await navigator.clipboard.writeText(`${window.location.origin}/s/${saved.slug}`); toast.success("Link copied"); }}><Copy size={13} aria-hidden />Copy link</button></p>
              <button type="button" className="button secondary" disabled={!!saving} onClick={() => setConfirm("unpublish")}><EyeOff size={16} aria-hidden />Unpublish</button>
            </div> : <div className="se-publish">
              <button type="button" className="button primary" disabled={!ready || !!saving} onClick={() => save("published")}><Rocket size={16} aria-hidden />{saving === "publish" ? "Publishing…" : dirty ? "Save and publish" : "Publish store"}</button>
              <span className="field-help">{ready ? "Publishing saves your changes and makes the store visible to everyone." : "Finish the steps above to publish."}</span>
            </div>}
          </section>}
        </div>

        <aside className="se-preview" aria-label="Phone preview">
          <div className="se-preview-head">
            <span>Phone preview</span>
            <button type="button" className="se-icon-button" aria-label="Reload preview" onClick={() => setPreviewVersion((version) => version + 1)}><RefreshCw size={14} aria-hidden /></button>
          </div>
          <div className="se-phone"><iframe key={framePath} src={framePath} title="Store preview at phone size" loading="lazy" /></div>
          <p className="se-preview-note" aria-live="polite">{!dirty ? "Up to date." : problems.length || livePreview.state === "blocked" ? "Fix the highlighted problem to see your latest changes here." : livePreview.state === "sending" ? "Updating…"
            : livePreview.version > 0 ? "Showing your unsaved changes. Only you can see them." : "Your changes show here a moment after you stop typing."}</p>
          <div className="se-assistant">
            <Sparkles size={15} aria-hidden />
            <p>Claude, ChatGPT or Codex can draft this store for you: copy, sections, reviews you received, images. <Link href="/admin/connections">Connect an assistant</Link>, then ask it to edit <strong>/s/{saved.slug}</strong>. It saves a draft; you review and publish.</p>
          </div>
        </aside>
      </div>

      {(dirty || saving) && <div className="se-savebar" role="region" aria-label="Unsaved changes">
        <span><span className="se-dot" aria-hidden />{published ? "Unsaved changes · saving updates the live store" : "Unsaved changes"}</span>
        <div>
          <button type="button" className="button secondary small" disabled={!!saving} onClick={() => setConfirm("discard")}>Discard</button>
          <button type="button" className="button primary small" disabled={!!saving} onClick={() => save()}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>}

      <ConfirmDialog open={confirm === "discard"} onOpenChange={(open) => setConfirm(open ? "discard" : null)} icon={<RefreshCw size={20} aria-hidden />}
        title="Discard your changes?" description="Everything since your last save is undone. Uploaded media stays in the library." confirm="Discard changes"
        onConfirm={() => { setDraft(baseline); setError(null); setConfirm(null); writeBackup(productId, null); }} />
      <ConfirmDialog open={confirm === "unpublish"} onOpenChange={(open) => setConfirm(open ? "unpublish" : null)} icon={<EyeOff size={20} aria-hidden />} pending={saving === "unpublish"}
        title="Unpublish this store?" description="Visitors, including anyone arriving from your ads, will see a not-found page until you publish again. Orders already placed aren't affected."
        confirm={saving === "unpublish" ? "Unpublishing…" : "Unpublish"} onConfirm={async () => { if (await save("draft")) setConfirm(null); }} />
    </div>
  </MediaProvider>;
}
