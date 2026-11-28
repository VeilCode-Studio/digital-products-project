import "server-only";
import { randomBytes } from "node:crypto";
import { Resend } from "resend";
import { getSupabase } from "./supabase";
import { getDeployment, getEnv } from "./env";
import { emailAllowed } from "./deployment-rules";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { hashToken, issueToken, MAX_DOWNLOADS, TOKEN_LIFETIME_DAYS } from "./tokens";
import type { CatalogProduct } from "./catalog.types";

// The email list. A visitor leaves an email for a free download the owner picks (stores.gift_product_id);
// the download link arrives by email, so every address on the list is real. Marketing emails are a
// separate, unticked choice, saved with the exact words shown and the time, so the list only ever
// contains people who asked to hear more, and each of them can unsubscribe with one click.

export const CONSENT_TEXT = "Email me when there are new products and offers. Unsubscribe any time.";
/** A second request for the same address within this window doesn't send another email. */
export const RESEND_COOLDOWN_MS = 10 * 60_000;

export type Subscriber = {
  id: string; store_id: string; email: string; marketing_consent: boolean; consent_text: string | null; consented_at: string | null;
  source: "free-download" | "manual"; gift_product_id: string | null; download_token_hash: string | null; download_count: number;
  token_expires_at: string | null; unsubscribe_token: string; unsubscribed_at: string | null; last_sent_at: string | null;
  created_at: string; updated_at: string;
};
export type Gift = { id: string; name: string; shortName: string; tagline: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const validEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && EMAIL.test(value.trim());

function toGift(product: CatalogProduct): Gift {
  return { id: product.id, name: product.name, shortName: product.name.split(":")[0].trim(), tagline: product.tagline };
}

/** The free download on offer, if the owner picked one and its file is uploaded. */
export async function currentGift(storeId = STORE_ID): Promise<Gift | null> {
  const db = getSupabase();
  const { data: store } = await db.from("stores").select("gift_product_id").eq("id", storeId).maybeSingle();
  const giftId = (store as { gift_product_id?: string | null } | null)?.gift_product_id;
  if (!giftId) return null;
  const { data: product } = await db.from("products").select("*").eq("store_id", storeId).eq("id", giftId).maybeSingle();
  const gift = product as CatalogProduct | null;
  return gift && gift.kind === "digital" && gift.storage_path ? toGift(gift) : null;
}

export async function setGift(productId: unknown, storeId = STORE_ID) {
  const db = getSupabase();
  let id: string | null = null;
  if (typeof productId === "string" && productId) {
    const { data } = await db.from("products").select("*").eq("store_id", storeId).eq("id", productId).maybeSingle();
    const product = data as CatalogProduct | null;
    if (!product || product.kind !== "digital") throw new HttpError(400, "Choose one of your digital products.");
    if (!product.storage_path) throw new HttpError(400, "Upload this product's file first, so there's something to send.");
    id = product.id;
  }
  const { error } = await db.from("stores").update({ gift_product_id: id }).eq("id", storeId);
  if (error) throw new HttpError(500, "Could not save the free download.");
  return { giftProductId: id };
}

function buildGiftEmail(gift: Gift, downloadUrl: string, unsubscribeUrl: string | null) {
  const limit = `This link works for ${TOKEN_LIFETIME_DAYS} days and up to ${MAX_DOWNLOADS} downloads.`;
  const footerHtml = unsubscribeUrl ? `<p style="font-size:12px;color:#737373">You asked to hear about new products and offers. <a style="color:#737373" href="${escape(unsubscribeUrl)}">Unsubscribe</a></p>` : "";
  return {
    subject: `Your free download: ${gift.shortName}`,
    html: `<div style="font-family:system-ui,sans-serif;color:#171717;line-height:1.6;max-width:560px">
<p>Here's <strong>${escape(gift.shortName)}</strong>, as promised.</p>
<p><a style="display:inline-block;background:#2B59FF;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600" href="${escape(downloadUrl)}">Download ${escape(gift.shortName)}</a></p>
<p>${limit}</p>
<p>Questions? Just reply to this email.</p>
<p>Frank<br>PodStore</p>
${footerHtml}
</div>`,
    text: `Here's ${gift.shortName}, as promised.

Download: ${downloadUrl}
${limit}

Questions? Just reply to this email.

Frank
PodStore${unsubscribeUrl ? `\n\nYou asked to hear about new products and offers. Unsubscribe: ${unsubscribeUrl}` : ""}`,
  };
}
function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export const unsubscribeUrl = (token: string) => {
  const url = new URL("/unsubscribe", getEnv().APP_URL);
  url.searchParams.set("token", token);
  return url.toString();
};

async function sendGiftEmail(subscriber: Subscriber, gift: Gift, token: string) {
  const env = getEnv();
  const deployment = getDeployment();
  if (!deployment.production && !emailAllowed(subscriber.email, deployment.emailAllowlist)) {
    console.warn("Non-production email blocked: recipient is not on EMAIL_ALLOWLIST");
    return false;
  }
  const download = new URL("/api/free-download", env.APP_URL);
  download.searchParams.set("token", token);
  const unsubscribe = subscriber.marketing_consent ? unsubscribeUrl(subscriber.unsubscribe_token) : null;
  const message = buildGiftEmail(gift, download.toString(), unsubscribe);
  const oneClick = new URL("/api/unsubscribe", env.APP_URL);
  oneClick.searchParams.set("token", subscriber.unsubscribe_token);
  const { data, error } = await new Resend(env.RESEND_API_KEY).emails.send({
    from: "PodStore <orders@mail.veilcode.studio>", replyTo: "support@veilcode.studio", to: subscriber.email,
    ...message,
    subject: deployment.production ? message.subject : `[${deployment.env === "preview" ? "Preview" : "Dev"}] ${message.subject}`,
    // One-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from senders of marketing mail.
    ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${oneClick.toString()}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
  }, { idempotencyKey: `gift-${subscriber.id}-${hashToken(token).slice(0, 16)}`, signal: AbortSignal.timeout(15_000) });
  if (error || !data) throw new HttpError(502, "We couldn't send the email just now. Please try again in a minute.");
  return true;
}

/**
 * A visitor asks for the free download. Always answers the same way whether or not the address is
 * already on the list, so the form can't be used to find out who has signed up.
 */
export async function subscribe(body: Record<string, unknown>) {
  // A hidden field people never see; bots fill it in. Pretend it worked and do nothing.
  if (typeof body.website === "string" && body.website.trim()) return { ok: true };
  if (!validEmail(body.email)) throw new HttpError(400, "Enter a valid email address.");
  const email = body.email.trim().toLowerCase();
  const marketing = body.marketing === true;
  const gift = await currentGift();
  if (!gift) throw new HttpError(404, "The free download isn't available right now.");

  const db = getSupabase();
  const now = new Date();
  const { data: found } = await db.from("subscribers").select("*").eq("store_id", STORE_ID).eq("email", email).maybeSingle();
  let subscriber = found as Subscriber | null;
  if (subscriber?.last_sent_at && now.getTime() - Date.parse(subscriber.last_sent_at) < RESEND_COOLDOWN_MS) return { ok: true };

  const token = issueToken();
  const consent = marketing ? { marketing_consent: true, consent_text: CONSENT_TEXT, consented_at: now.toISOString(), unsubscribed_at: null } : {};
  const changes = { gift_product_id: gift.id, download_token_hash: token.hash, download_count: 0, token_expires_at: token.expiresAt, last_sent_at: now.toISOString(), updated_at: now.toISOString(), ...consent };
  if (subscriber) {
    const { data, error } = await db.from("subscribers").update(changes).eq("id", subscriber.id).select("*").single();
    if (error || !data) throw new HttpError(500, "Something went wrong. Please try again.");
    subscriber = data as Subscriber;
  } else {
    const { data, error } = await db.from("subscribers").insert({
      store_id: STORE_ID, email, source: "free-download", unsubscribe_token: randomBytes(24).toString("base64url"), marketing_consent: false, ...changes,
    }).select("*").single();
    if (error || !data) throw new HttpError(500, "Something went wrong. Please try again.");
    subscriber = data as Subscriber;
  }
  try { await sendGiftEmail(subscriber, gift, token.token); }
  catch (error) {
    // Let them try again straight away if the email didn't go.
    await db.from("subscribers").update({ last_sent_at: null }).eq("id", subscriber.id);
    throw error;
  }
  return { ok: true };
}

/** One use of a free download link; null when it's expired, used up or unknown. */
export async function consumeGiftDownload(token: string): Promise<CatalogProduct | null> {
  const { data, error } = await getSupabase().rpc("consume_gift_download", { p_token_hash: hashToken(token), p_max: MAX_DOWNLOADS });
  if (error) throw new Error("Could not check the download");
  const giftId = (Array.isArray(data) ? data[0] : data)?.gift_product_id as string | undefined;
  if (!giftId) return null;
  const { data: product } = await getSupabase().from("products").select("*").eq("store_id", STORE_ID).eq("id", giftId).maybeSingle();
  const gift = product as CatalogProduct | null;
  return gift?.storage_path ? gift : null;
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32,64}$/;

export async function findByUnsubscribeToken(token: unknown): Promise<Subscriber | null> {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return null;
  const { data } = await getSupabase().from("subscribers").select("*").eq("unsubscribe_token", token).maybeSingle();
  return (data as Subscriber | null) ?? null;
}

/** Stops marketing emails. Idempotent; an unknown token is quietly ignored. */
export async function unsubscribe(token: unknown) {
  const subscriber = await findByUnsubscribeToken(token);
  if (!subscriber) return false;
  if (!subscriber.marketing_consent && subscriber.unsubscribed_at) return true;
  const now = new Date().toISOString();
  const { error } = await getSupabase().from("subscribers").update({ marketing_consent: false, unsubscribed_at: now, updated_at: now }).eq("id", subscriber.id);
  if (error) throw new Error("Could not unsubscribe");
  return true;
}

export type SubscriberSummary = { total: number; consented: number; unsubscribed: number; last7: number };

export async function listSubscribers(storeId = STORE_ID): Promise<{ subscribers: Subscriber[]; summary: SubscriberSummary }> {
  const { data, error } = await getSupabase().from("subscribers").select("*").eq("store_id", storeId).order("created_at", { ascending: false }).limit(5000);
  if (error) throw new HttpError(503, "Subscribers are temporarily unavailable.");
  const subscribers = (data ?? []) as Subscriber[];
  const week = Date.now() - 7 * 86400_000;
  return {
    subscribers,
    summary: {
      total: subscribers.length,
      consented: subscribers.filter((entry) => entry.marketing_consent).length,
      unsubscribed: subscribers.filter((entry) => entry.unsubscribed_at).length,
      last7: subscribers.filter((entry) => Date.parse(entry.created_at) >= week).length,
    },
  };
}
