import "server-only";
import { currentStripeConnection } from "./payment-connections";
import { listProducts } from "./catalog";
import { getSupabase } from "./supabase";
import { STORE_ID } from "./store-config";
import { getDeployment } from "./env";
import { isOverdue } from "./order-dates";
import { cjBalance, cjConfigured, cjPidFromUrl, cjSubscribedProducts } from "./cj";
import type { ProductVariant } from "./catalog.types";
import type { Order } from "./database.types";

// The live half of the go-live checklist (/admin/go-live): what the store can check for itself.
// Never includes secret values, only whether they're set.

export type LiveCheck = {
  id: string; title: string; detail: string;
  status: "done" | "todo" | "warn";
  link?: { href: string; label: string };
  /** A button the page shows to fix it from there. */
  action?: "connect-cj";
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export async function liveChecks(storeId = STORE_ID): Promise<{ production: boolean; checks: LiveCheck[] }> {
  const production = getDeployment().production;
  const checks: LiveCheck[] = [];
  if (storeId !== STORE_ID) {
    const [payment, products] = await Promise.all([currentStripeConnection(storeId), listProducts(false, undefined, storeId)]);
    return { production, checks: [
      { id: "payments", status: payment?.status === "connected" ? "done" : "todo", title: "Connect your Stripe account", detail: "Your own payment account receives customer payments.", link: { href: "/admin/settings", label: "Payment settings" } },
      { id: "catalog", status: products.some(p => p.status === "published") ? "done" : "todo", title: "Publish your first product", detail: "Prepare the product, files or shipping policies, then publish it.", link: { href: "/admin/products", label: "Products" } },
      { id: "fulfillment", status: "done", title: "Manual supplier fulfilment", detail: "Physical orders can be managed under Fulfilment. Platform supplier accounts are not shared.", link: { href: "/admin/fulfillment", label: "Fulfilment" } },
    ] };
  }
  const cj = cjConfigured();
  const db = getSupabase();

  checks.push(cj
    ? { id: "cj-key", status: "done", title: "CJ is connected", detail: "CJ_API_KEY is set in this environment." }
    : { id: "cj-key", status: "todo", title: "Connect CJ", detail: "Add CJ_API_KEY to this environment in Vercel (Settings → Environment Variables), then redeploy." });

  checks.push(process.env.CRON_SECRET?.trim()
    ? { id: "cron", status: "done", title: "The daily job can run", detail: "CRON_SECRET is set, so tracking, prices, stock and review requests are checked every day." }
    : { id: "cron", status: "todo", title: "Let the daily job run", detail: "Add CRON_SECRET (any long random text) in Vercel. Without it, tracking, price, stock and review checks never run." });

  if (cj) {
    const [balance, subscribed] = await Promise.all([cjBalance().catch(() => null), production ? cjSubscribedProducts().catch(() => null) : Promise.resolve(null)]);
    checks.push(balance === null
      ? { id: "cj-balance", status: "warn", title: "CJ wallet balance", detail: "CJ didn't answer just now. Reload to check your balance." }
      : balance <= 0
        ? { id: "cj-balance", status: "todo", title: "Top up your CJ wallet", detail: "Your CJ balance is $0.00. Orders placed from Fulfilment are paid from it, so top it up in CJ (My CJ → Wallet) first." }
        : { id: "cj-balance", status: balance < 5000 ? "warn" : "done", title: "CJ wallet balance", detail: `$${(balance / 100).toFixed(2)} available.${balance < 5000 ? " That covers only a few orders; top up before running ads." : ""}` });
    checks.push(!production
      ? { id: "cj-updates", status: "warn", title: "Instant CJ updates (live store only)", detail: "Connect these from the live store's checklist. CJ can't reach staging, and it allows one address per account." }
      : subscribed
        ? { id: "cj-updates", status: "done", title: "Instant CJ updates are on", detail: `CJ tells the store about tracking, stock and product changes within minutes (${plural(subscribed, "product")} watched). Connecting again is safe.`, action: "connect-cj" }
        : { id: "cj-updates", status: "todo", title: "Turn on instant CJ updates", detail: "Orders get tracking and stock alerts land within minutes instead of once a day. Link at least one variant to CJ first.", action: "connect-cj" });
  }

  const { data: variantRows } = await db.from("product_variants").select("*").eq("store_id", STORE_ID).eq("active", true);
  const variants = (variantRows ?? []) as ProductVariant[];
  const cjVariants = variants.filter((variant) => cjPidFromUrl(variant.supplier_url));
  const noSku = cjVariants.filter((variant) => !variant.supplier_sku?.trim()).length;
  checks.push(!cjVariants.length
    ? { id: "cj-sku", status: "warn", title: "Link variants to CJ", detail: "No variant links to a CJ product page yet. Paste the CJ link and CJ's variant SKU on each variant in the store editor.", link: { href: "/admin/stores", label: "Physical stores" } }
    : noSku
      ? { id: "cj-sku", status: "todo", title: "Add CJ's variant SKU to every CJ variant", detail: `${plural(noSku, "variant")} linked to CJ ${noSku === 1 ? "has" : "have"} no supplier SKU. It's needed to order the right colour or size, unless the CJ product has only one variant.`, link: { href: "/admin/stores", label: "Physical stores" } }
      : { id: "cj-sku", status: "done", title: "Every CJ variant has its SKU", detail: `${plural(cjVariants.length, "variant")} linked to CJ.` });

  const alerts = variants.filter((variant) => variant.supplier_alert).length;
  const missingCost = variants.filter((variant) => variant.unit_cost === null || variant.unit_cost === undefined).length;
  checks.push(alerts
    ? { id: "alerts", status: "todo", title: "Supplier alerts to look at", detail: `${plural(alerts, "variant")} ${alerts === 1 ? "has" : "have"} a price, stock or matching alert. Out-of-stock variants stay on sale until you turn them off.`, link: { href: "/admin/margins", label: "Margins" } }
    : { id: "alerts", status: "done", title: "No supplier alerts", detail: "No price rises, low stock or unmatched variants." });
  checks.push(missingCost
    ? { id: "costs", status: "warn", title: "Supplier costs missing", detail: `${plural(missingCost, "variant")} ${missingCost === 1 ? "has" : "have"} no cost yet, so their margin is unknown. CJ variants fill in at the next daily check.`, link: { href: "/admin/margins", label: "Margins" } }
    : { id: "costs", status: "done", title: "Every variant has a cost", detail: "Margins are up to date." });

  const { data: openRows } = await db.from("orders").select("*").eq("store_id", STORE_ID).eq("kind", "physical").in("fulfillment_status", ["needs_ordering", "ordered"]).limit(500);
  const overdue = ((openRows ?? []) as Order[]).filter((order) => isOverdue(order)).length;
  checks.push(overdue
    ? { id: "overdue", status: "todo", title: "Orders past their ship-by date", detail: `${plural(overdue, "order")} should have shipped by now. Order them, or email a delay notice (the FTC's Mail Order Rule requires one).`, link: { href: "/admin/fulfillment", label: "Fulfilment" } }
    : { id: "overdue", status: "done", title: "No overdue orders", detail: "Everything open is within its ship-by date." });

  return { production, checks };
}
