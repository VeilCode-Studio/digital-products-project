"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { OPT_OUT_COOKIE } from "@/lib/tiktok-pixel";

// The ad pixels on store pages (TikTok and Meta), and the store's ad-tracking opt-out. No pixel loads for
// a browser sending a Global Privacy Control signal, or after the shopper opts out on the store.

type Ttq = { track: (event: string, params?: Record<string, unknown>, options?: { event_id?: string }) => void };
type Pending = [string, Record<string, unknown> | undefined, { event_id?: string } | undefined];
type Fbq = (command: "track", event: string, params?: Record<string, unknown>, options?: { eventID?: string }) => void;
type FbqPending = [string, Record<string, unknown> | undefined, { eventID?: string } | undefined];
declare global {
  interface Window { ttq?: Ttq; __stTtqPending?: Pending[]; fbq?: Fbq; __stFbqPending?: FbqPending[] }
  interface Navigator { globalPrivacyControl?: boolean }
}

function optedOutNow() {
  return navigator.globalPrivacyControl === true || new RegExp(`(?:^|; )${OPT_OUT_COOKIE}=1`).test(document.cookie);
}

/** Reports one event; queues it if the pixel hasn't loaded yet, and does nothing when opted out. */
export function trackTikTok(event: string, params?: Record<string, unknown>, eventId?: string) {
  if (typeof window === "undefined" || optedOutNow()) return;
  const options = eventId ? { event_id: eventId } : undefined;
  if (window.ttq) window.ttq.track(event, params, options);
  else (window.__stTtqPending ??= []).push([event, params, options]);
}

type Contents = { content_id: string; content_name?: string; quantity: number; price: number }[];

/**
 * Reports one event to the Meta pixel, from the same TikTok-shaped details: Meta names the fields
 * differently (content_ids, contents[].id) and dedupes with eventID against the server's event.
 */
export function trackMeta(event: string, params?: Record<string, unknown>, eventId?: string) {
  if (typeof window === "undefined" || optedOutNow()) return;
  const contents = (params?.contents as Contents | undefined) ?? [];
  const ids = contents.length ? contents.map((item) => item.content_id) : typeof params?.content_id === "string" ? [params.content_id] : [];
  const meta: Record<string, unknown> = {
    content_type: "product", content_ids: ids,
    ...(params?.currency ? { currency: params.currency } : {}), ...(typeof params?.value === "number" ? { value: params.value } : {}),
    ...(contents.length ? { contents: contents.map((item) => ({ id: item.content_id, quantity: item.quantity, item_price: item.price })), num_items: contents.reduce((sum, item) => sum + item.quantity, 0) } : {}),
    ...(typeof params?.content_name === "string" ? { content_name: params.content_name } : {}),
  };
  const options = eventId ? { eventID: eventId } : undefined;
  if (window.fbq) window.fbq("track", event, meta, options);
  else (window.__stFbqPending ??= []).push([event, meta, options]);
}

/** Reports to every pixel the store uses (an unused pixel's queue is simply never read). */
export function trackAds(event: string, params?: Record<string, unknown>, eventId?: string) {
  trackTikTok(event, params, eventId);
  trackMeta(event, params, eventId);
}

/** Fires one event when the page shows, e.g. ViewContent on the store or Purchase on the thank-you page. */
export function AdEvent({ event, params, eventId }: { event: string; params: Record<string, unknown>; eventId?: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackAds(event, params, eventId);
  }, [event, params, eventId]);
  return null;
}

const subscribe = () => () => {};
const readChoice = () => navigator.globalPrivacyControl === true ? "gpc" : new RegExp(`(?:^|; )${OPT_OUT_COOKIE}=1`).test(document.cookie) ? "out" : "in";

/** "Your privacy choices": opt out of ad tracking on this store (a US state privacy right). */
export function AdChoices({ platforms }: { platforms: string }) {
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  if (choice === null) return null;
  if (choice === "gpc") return <p className="st-choices-status" role="status">Your browser is sending a Global Privacy Control signal, so we don&apos;t share your information for advertising.</p>;
  const set = (out: boolean) => {
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = out ? `${OPT_OUT_COOKIE}=1; path=/; max-age=31536000; samesite=lax${secure}` : `${OPT_OUT_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
    if (out) for (const name of ["st_ttclid", "_fbc", "_fbp"]) document.cookie = `${name}=; path=/; max-age=0; samesite=lax${secure}`;
    // Reload so the pixel is loaded, or not, from a clean page.
    location.reload();
  };
  return <div className="st-choices">
    <p className="st-choices-status" role="status">{choice === "out" ? `You've opted out: we don't share your information with ${platforms} for advertising on this browser.` : `We currently use the ${platforms} pixel${platforms.includes(" and ") ? "s" : ""} on this browser to measure our ads.`}</p>
    <button type="button" className="st-button small" onClick={() => set(choice !== "out")}>{choice === "out" ? "Allow ad measurement again" : "Don't share my information for ads"}</button>
  </div>;
}
