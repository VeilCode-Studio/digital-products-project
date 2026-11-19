"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, Link2, Package, Plug, Radar, Receipt, Settings, Store, TicketPercent, Truck } from "lucide-react";

// The sidebar, in the order the work flows: find, sell, fulfil, measure, then the assistants and settings.
export const ADMIN_LINKS = [
  { href: "/admin", label: "Overview", Icon: LayoutDashboard },
  { href: "/admin/research", label: "Research", Icon: Radar },
  { href: "/admin/products", label: "Digital products", Icon: Package },
  { href: "/admin/stores", label: "Physical stores", Icon: Store },
  { href: "/admin/orders", label: "Orders", Icon: Receipt },
  { href: "/admin/fulfillment", label: "Fulfilment", Icon: Truck },
  { href: "/admin/analytics", label: "Analytics", Icon: BarChart3 },
  { href: "/admin/links", label: "Short links", Icon: Link2 },
  { href: "/admin/discounts", label: "Discount codes", Icon: TicketPercent },
  { href: "/admin/connections", label: "Connections", Icon: Plug },
  { href: "/admin/settings", label: "Store settings", Icon: Settings },
] as const;

/** The section a URL belongs to, by its longest matching link. New stores live under /admin/products. */
function sectionFor(pathname: string | null) {
  if (!pathname) return null;
  if (pathname.startsWith("/admin/products/new-store")) return "/admin/stores";
  return [...ADMIN_LINKS].map((link) => link.href).filter((href) => pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

const SectionContext = createContext<{ override: string | null; setOverride: (href: string | null) => void }>({ override: null, setOverride: () => {} });

/** Holds a page's own section, for URLs that can't say it (a physical store's editor is under /admin/products). */
export function AdminNavProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<string | null>(null);
  return <SectionContext.Provider value={{ override, setOverride }}>{children}</SectionContext.Provider>;
}

/** Rendered by a page to name its section; cleared when the page goes away. */
export function NavSection({ href }: { href: string }) {
  const { setOverride } = useContext(SectionContext);
  useEffect(() => { setOverride(href); return () => setOverride(null); }, [href, setOverride]);
  return null;
}

export function AdminNav() {
  const pathname = usePathname();
  const { override } = useContext(SectionContext);
  const fromUrl = sectionFor(pathname);
  // The override belongs to the page that set it; while another page loads, the URL decides.
  const active = override && (fromUrl === "/admin/products" || fromUrl === override) ? override : fromUrl;
  return <nav aria-label="Studio navigation">{ADMIN_LINKS.map(({ href, label, Icon }) => (
    <Link key={href} href={href} className={active === href ? "active" : ""} aria-current={active === href ? "page" : undefined}><Icon size={18} />{label}</Link>
  ))}</nav>;
}
