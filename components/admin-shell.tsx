import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { ArrowUpRight } from "lucide-react";
import { Brand } from "./store";
import { AdminProfileMenu, SignOutButton } from "./admin-account-menu";
import { AdminNav, AdminNavProvider } from "./admin-nav";
import { ownerProfile } from "@/lib/owner-profile";
import { monaSans } from "@/app/studio-fonts";

/**
 * The workspace frame: sidebar, top bar and content area. It is rendered once by the workspace layout
 * (app/admin/(workspace)/layout.tsx), so it stays put while pages and their loading states swap inside it.
 */
export function AdminShell({ children, storeName = "PodStore", owner, storefrontHref = "/" }: {
  children: React.ReactNode;
  /** Older callers named the active link; the nav now reads it from the URL. */
  active?: string;
  storeName?: string;
  storefrontHref?: string;
  owner?: Pick<User, "email" | "user_metadata">;
}) {
  const profile = ownerProfile(owner);
  return <AdminNavProvider><div className={`admin-shell ${monaSans.variable}`}>
    <aside className="admin-sidebar">
      <Brand name={storeName} />
      <AdminNav />
      <div className="sidebar-bottom">
        <Link href={storefrontHref} target="_blank" rel="noopener noreferrer">View your store <ArrowUpRight size={17} /></Link>
        <SignOutButton />
        <span className="sidebar-footnote">A little structure. More good work.</span>
      </div>
    </aside>
    <div className="admin-main">
      <header className="admin-topbar">
        <span>Studio workspace</span>
        <div className="admin-topbar-actions">
          <Link href={storefrontHref} target="_blank" rel="noopener noreferrer">Your storefront <ArrowUpRight size={14} /></Link>
          <AdminProfileMenu profile={profile} storeName={storeName} />
        </div>
      </header>
      <main className="admin-content">{children}</main>
    </div>
  </div></AdminNavProvider>;
}
