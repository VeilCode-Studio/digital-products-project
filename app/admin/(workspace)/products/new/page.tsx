import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ownerPage } from "@/lib/auth";
import { relatedChoices } from "@/lib/related-products";
import { NavSection } from "@/components/admin-nav";
import { ProductEditor } from "@/components/product-editor";

export const dynamic = "force-dynamic";
export default async function NewProduct() {
  await ownerPage();
  const related = await relatedChoices(null);
  return <><NavSection href="/admin/products" /><Link href="/admin/products" className="back-link"><ArrowLeft size={15} /> All digital products</Link><div className="admin-page-heading"><div><span className="eyebrow">FROM IDEA TO INBOX</span><h1>Something worth sharing.</h1><p>Give your next digital product a home.</p></div></div><ProductEditor id={randomUUID()} product={null} related={related} /></>;
}
