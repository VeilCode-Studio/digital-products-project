import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { NavSection } from "@/components/admin-nav";
import { NewStoreForm } from "@/components/store-editor/new-store-form";
import { listResearch } from "@/lib/research";
import "../../../store-editor.css";

export const dynamic = "force-dynamic";
export default async function NewStorePage() {
  await ownerPage();
  const research = await listResearch();
  // Physical ideas that are still in play and don't have a store yet.
  const ideas = research.filter((idea) => idea.kind !== "digital" && !idea.store_product_id && idea.stage !== "rejected")
    .map((idea) => ({ id: idea.id, title: idea.title, stage: idea.stage }));
  return <><NavSection href="/admin/stores" />
    <Link href="/admin/stores" className="back-link"><ArrowLeft size={15} /> All stores</Link>
    <div className="admin-page-heading"><div><span className="eyebrow">A STORE FOR ONE GREAT PRODUCT</span><h1>New physical store</h1><p>A premium single-product page, shipped from your supplier.</p></div></div>
    <NewStoreForm ideas={ideas} />
  </>;
}
