import { workspaceForUser } from "@/lib/workspace";
import { ownerPage } from "@/lib/auth";
import { listMarginRows, MARGIN_TARGET, summarize, type MarginRow } from "@/lib/margins";
import { NavSection } from "@/components/admin-nav";
import { MarginsView } from "@/components/margins-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Margins" };

export default async function MarginsPage() {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  let rows: MarginRow[] | null = null;
  try { rows = await listMarginRows(undefined, storeId); }
  catch (error) { console.error("Margins unavailable", error instanceof Error ? error.message.slice(0, 200) : ""); }
  return <><NavSection href="/admin/margins" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">WHAT EACH SALE REALLY EARNS</span><h1>Margins</h1><p>Supplier costs for every physical variant, the margin they leave, and which supplier prices are due a check.</p></div>
    </div>
    {rows ? <MarginsView rows={rows} summary={summarize(rows)} target={MARGIN_TARGET} />
      : <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">TRY AGAIN SHORTLY</span><h1>Margins couldn&apos;t load.</h1><p>Reload the page in a moment.</p></section>}
  </>;
}
