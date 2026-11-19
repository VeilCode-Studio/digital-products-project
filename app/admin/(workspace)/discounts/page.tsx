import { ownerPage } from "@/lib/auth";
import { getStore } from "@/lib/catalog";
import { listDiscountCodes, type DiscountCodeRow } from "@/lib/discount-codes";
import { NavSection } from "@/components/admin-nav";
import { DiscountCodes } from "@/components/discount-codes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discount codes" };

export default async function DiscountsPage() {
  await ownerPage();
  const store = await getStore();
  let codes: DiscountCodeRow[] | null = null;
  try { codes = await listDiscountCodes(); }
  catch (error) { console.error("Discount codes unavailable", error instanceof Error ? error.message.slice(0, 200) : ""); }
  return <><NavSection href="/admin/discounts" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">A REASON TO BUY TODAY</span><h1>Discount codes</h1><p>Codes shoppers type at checkout, like TIKTOK10, and the sales each one brings in.</p></div>
    </div>
    {codes ? <DiscountCodes codes={codes} thankYouCodeId={store.thank_you_code_id ?? null} />
      : <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">TRY AGAIN SHORTLY</span><h1>Discount codes couldn&apos;t load.</h1><p>Reload the page in a moment. If it keeps happening, the discount codes database update may be missing.</p></section>}
  </>;
}
