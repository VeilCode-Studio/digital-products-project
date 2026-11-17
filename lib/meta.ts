import "server-only";
import { getDeployment, getEnv } from "./env";
import { e164, sha256 } from "./tiktok";
import type { AdAttribution, Checkout } from "./catalog.types";
import type { Order } from "./database.types";

// Meta (Facebook/Instagram) ads measurement for physical stores, alongside TikTok's (lib/tiktok.ts).
// The browser pixel reports page views, product views, checkouts and purchases; purchases are also
// sent from the server through the Conversions API with the same event id, so Meta counts each once
// even when the pixel is blocked. Shoppers who opt out are tracked by neither.

export const META_PIXEL = /^\d{10,20}$/;
export const META_GRAPH_VERSION = "v24.0";

/** Server access tokens per pixel, from META_ACCESS_TOKENS="PIXELID=token,OTHERPIXEL=token". */
function accessTokens() {
  const tokens = new Map<string, string>();
  for (const pair of (process.env.META_ACCESS_TOKENS ?? "").split(",")) {
    const split = pair.indexOf("=");
    if (split < 1) continue;
    const pixel = pair.slice(0, split).trim();
    const token = pair.slice(split + 1).trim();
    if (META_PIXEL.test(pixel) && token) tokens.set(pixel, token);
  }
  return tokens;
}
/** Pixel IDs that can send server events (never the tokens themselves). */
export function metaPixelsWithServerEvents() { return [...accessTokens().keys()]; }

/** The Purchase event, matching what the thank-you page's pixel reports for the same checkout. */
export function metaPurchaseEvent(checkout: Checkout, order: Order, attribution: AdAttribution, testEventCode?: string) {
  const item = checkout.physical_snapshot!.items[0];
  // Meta matches phone numbers as digits with the country code and no plus sign.
  const phone = e164(order.shipping_address?.phone)?.slice(1);
  const address = order.shipping_address;
  const hashed = (value: string | null | undefined) => value ? [sha256(value.trim().toLowerCase())] : undefined;
  const firstName = order.customer_name?.trim().split(/\s+/)[0];
  return {
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
    data: [{
      event_name: "Purchase", event_time: Math.floor(Date.parse(order.created_at) / 1000), event_id: checkout.id, action_source: "website",
      event_source_url: attribution.url ?? new URL(`/s/${checkout.product_slug}`, getEnv().APP_URL).toString(),
      user_data: {
        em: hashed(order.email),
        ...(phone ? { ph: [sha256(phone)] } : {}),
        ...(firstName ? { fn: hashed(firstName) } : {}),
        ...(address?.postal_code ? { zp: hashed(address.postal_code.replace(/\s/g, "").slice(0, 5)) } : {}),
        ...(address?.state ? { st: hashed(address.state) } : {}),
        ...(address?.city ? { ct: hashed(address.city.replace(/\s/g, "")) } : {}),
        country: [sha256("us")],
        ...(attribution.fbc ? { fbc: attribution.fbc } : {}),
        ...(attribution.fbp ? { fbp: attribution.fbp } : {}),
        ...(attribution.ip ? { client_ip_address: attribution.ip } : {}),
        ...(attribution.userAgent ? { client_user_agent: attribution.userAgent } : {}),
      },
      custom_data: {
        currency: checkout.currency.toUpperCase(), value: checkout.amount / 100, content_type: "product",
        content_ids: [item.productId], num_items: item.quantity,
        contents: [{ id: item.productId, quantity: item.quantity, item_price: item.unitAmount / 100 }],
      },
    }],
  };
}

/**
 * Sends a paid physical order to Meta's Conversions API when the store has a pixel with a server token
 * and the shopper didn't opt out. Outside production it only sends with META_TEST_EVENT_CODE, so staging
 * shows up under Test Events instead of real reporting.
 */
export async function sendMetaPurchase(pixelId: string | null | undefined, checkout: Checkout, order: Order) {
  const attribution = checkout.attribution;
  if (!pixelId || !attribution) return "skipped";
  const token = accessTokens().get(pixelId);
  if (!token) return "skipped";
  const testEventCode = getDeployment().production ? undefined : process.env.META_TEST_EVENT_CODE?.trim() || undefined;
  if (!getDeployment().production && !testEventCode) return "skipped";

  const response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(metaPurchaseEvent(checkout, order, attribution, testEventCode)),
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json().catch(() => null) as { events_received?: number; error?: { code?: number } } | null;
  if (!response.ok || !result?.events_received) throw new Error(`Meta did not accept the event (${result?.error?.code ?? response.status})`);
  return "sent";
}
