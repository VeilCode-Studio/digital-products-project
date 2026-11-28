import { ownerPage } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { getStore } from "@/lib/catalog";
import { NavSection } from "@/components/admin-nav";
import { SettingsForm } from "@/components/settings-form";
import { PaymentSettings } from "@/components/payment-settings";
import { connectEnabled, connectConfigured, currentStripeConnection, stripeLivemode } from "@/lib/payment-connections";

export const dynamic = "force-dynamic";
export default async function Settings({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const [store, connection, params] = await Promise.all([getStore(storeId), currentStripeConnection(storeId), searchParams]);
  const result = ["connected", "restricted", "cancelled", "failed"].includes(params.payment ?? "") ? params.payment : undefined;
  return <><NavSection href="/admin/settings" /><div className="admin-page-heading"><div><span className="eyebrow">MAKE YOURSELF AT HOME</span><h1>Store settings</h1><p>A few details that make this space yours.</p></div></div><SettingsForm store={store} /><PaymentSettings enabled={connectEnabled()} configured={connectConfigured()} livemode={stripeLivemode()} connection={connection ? { accountId: connection.external_account_id, status: connection.status, country: connection.country, requirementsCount: connection.requirements.length } : null} result={result} /></>;
}
