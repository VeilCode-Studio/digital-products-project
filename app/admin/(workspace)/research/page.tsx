import { ownerPage } from "@/lib/auth";
import { listResearch } from "@/lib/research";
import { metaConfigured } from "@/lib/meta-ads";
import { cjConfigured } from "@/lib/cj";
import { NavSection } from "@/components/admin-nav";
import { ResearchWorkspace } from "@/components/research/research-workspace";
import "../../research.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Product research" };

export default async function ResearchPage() {
  await ownerPage();
  const items = await listResearch();
  return <><NavSection href="/admin/research" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">FIND THE NEXT WINNER</span><h1>Product research</h1><p>Spot what&apos;s selling, check the numbers, then turn it into a store.</p></div>
    </div>
    <ResearchWorkspace initialItems={items} meta={metaConfigured()} cj={cjConfigured()} />
  </>;
}
