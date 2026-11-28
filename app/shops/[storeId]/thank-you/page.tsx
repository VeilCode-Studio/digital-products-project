import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/catalog";
import { findCheckout } from "@/lib/checkout";
import { findOrder } from "@/lib/orders";
import { storePath, STORE_UUID } from "@/lib/storefront-paths";
import { digitalOffers } from "@/lib/thank-you-offers";
import { ThankYouOffers } from "@/components/site/thank-you-offers";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your purchase", robots: { index: false, follow: false } };
export default async function ThankYou({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { storeId } = await params;
  if (!STORE_UUID.test(storeId)) notFound();
  const store = await getStore(storeId).catch(() => null);
  if (!store) notFound();
  const { ref } = await searchParams;
  const checkout = ref && STORE_UUID.test(ref) ? await findCheckout(ref, storeId) : null;
  const order = checkout?.stripe_session_id ? await findOrder(checkout.stripe_session_id) : null;
  const paid = order?.store_id === storeId;
  const offers = paid ? await digitalOffers(ref, storeId) : { code: null, products: [] };
  return <main className="login-page"><section className="login-panel"><h1>{paid ? "Thank you for your purchase." : "Checking your payment"}</h1><p>{paid ? "Your download link will arrive at the email you used at checkout." : "Payment confirmation may take a moment. Your order email will confirm when it succeeds."}</p><ThankYouOffers offers={offers} /><Link href={storePath(storeId)}>Back to {store.name}</Link><p><a href={`mailto:${store.support_email}`}>Contact support</a></p></section></main>;
}
