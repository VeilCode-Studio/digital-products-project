import { ownerPage } from "@/lib/auth";
import { listConnections, mcpResource } from "@/lib/mcp/oauth";
import { recentActivity } from "@/lib/mcp/activity";
import { NavSection } from "@/components/admin-nav";
import { ConnectionsView } from "@/components/connections/connections-view";
import "../../connections.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  await ownerPage();
  const [connections, activity] = await Promise.all([listConnections(), recentActivity()]);
  return <><NavSection href="/admin/connections" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">YOUR ASSISTANTS</span><h1>Connections</h1><p>Let Claude, ChatGPT, Codex and Claude Code read the store, research products and build drafts.</p></div>
    </div>
    <ConnectionsView endpoint={mcpResource()} initialConnections={connections} activity={activity} />
  </>;
}
