import { ownerPage } from "@/lib/auth";
import { getStore } from "@/lib/catalog";
import { AdminShell } from "@/components/admin-shell";

/**
 * Every signed-in workspace page shares this frame, so moving between pages only swaps the content
 * area and the sidebar never leaves the screen. Pages still check the owner themselves.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [owner, store] = await Promise.all([ownerPage(), getStore()]);
  return <AdminShell owner={owner} storeName={store.name}>{children}</AdminShell>;
}
