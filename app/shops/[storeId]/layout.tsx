import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/catalog";
import { STORE_UUID } from "@/lib/storefront-paths";

export async function generateMetadata({ params }: { params: Promise<{ storeId: string }> }): Promise<Metadata> {
  const { storeId } = await params;
  if (!STORE_UUID.test(storeId)) notFound();
  const store = await getStore(storeId).catch(() => null);
  if (!store) notFound();
  return {
    title: { default: store.name, template: `%s | ${store.name}` },
    description: store.tagline || `Shop ${store.name}.`,
    openGraph: { siteName: store.name, type: "website" },
  };
}

export default function ShopLayout({ children }: { children: React.ReactNode }) { return children; }
