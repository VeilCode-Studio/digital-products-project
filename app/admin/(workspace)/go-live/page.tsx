import { ownerPage } from "@/lib/auth";
import { liveChecks } from "@/lib/go-live";
import { NavSection } from "@/components/admin-nav";
import { GoLiveChecklist } from "@/components/go-live-checklist";

export const dynamic = "force-dynamic";
export const metadata = { title: "Go-live checklist" };

export default async function GoLivePage() {
  await ownerPage();
  let live: Awaited<ReturnType<typeof liveChecks>> | null = null;
  try { live = await liveChecks(); }
  catch (error) { console.error("Go-live checks unavailable", error instanceof Error ? error.message.slice(0, 200) : ""); }
  return <><NavSection href="/admin/go-live" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">BEFORE AND AFTER YOU START SELLING</span><h1>Go-live checklist</h1><p>What to set up and watch when you sell physical products and order them from CJ{live && !live.production ? ". You're on staging: the live store's checklist has the real numbers" : ""}.</p></div>
    </div>
    {live ? <GoLiveChecklist checks={live.checks} />
      : <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">TRY AGAIN SHORTLY</span><h1>The checklist couldn&apos;t load.</h1><p>Reload the page in a moment.</p></section>}
  </>;
}
