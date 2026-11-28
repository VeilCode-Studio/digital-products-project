import { storePath } from "@/lib/storefront-paths";
import { ownerPage } from "@/lib/auth";
import { getStore } from "@/lib/catalog";
import { workspaceForUser } from "@/lib/workspace";
import { AdminShell } from "@/components/admin-shell";

/**
 * Every signed-in workspace page shares this frame, so moving between pages only swaps the content
 * area and the sidebar never leaves the screen. Pages still check the owner themselves.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const store = await getStore(storeId);
  return <AdminShell owner={owner} storeName={store.name} storefrontHref={storePath(storeId) || "/"}>{children}</AdminShell>;
}
