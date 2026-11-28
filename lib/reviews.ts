import "server-only";
import { Resend } from "resend";
import { getSupabase } from "./supabase";
import { getDeployment, getEnv } from "./env";
import { emailAllowed } from "./deployment-rules";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { hashToken, issueToken } from "./tokens";
import type { Order } from "./database.types";
import type { CatalogProduct } from "./catalog.types";

// Customer reviews. A few days after an order arrives, the buyer gets exactly one email asking for a
// rating (sendReviewRequests, run daily by /api/cron/daily). The link is tied to that paid order, so
// every review is a verified purchase. Reviews wait for the owner's approval before they show.

export type Review = {
  id: string; store_id: string; order_id: string; product_id: string; rating: number; title: string | null; body: string | null;
  display_name: string; status: "pending" | "approved" | "hidden"; created_at: string; updated_at: string; approved_at: string | null;
};
export type PublicReview = Pick<Review, "id" | "rating" | "title" | "body" | "display_name" | "created_at">;

/** Digital buyers are asked this long after buying; physical buyers this long after delivery. */
export const DIGITAL_DELAY_DAYS = 5;
export const PHYSICAL_DELAY_DAYS = 4;
/** Without a delivery date, ask this long after shipping. */
export const SHIPPED_DELAY_DAYS = 12;
/** Older orders are never asked: a request months later feels odd. */
export const MAX_AGE_DAYS = 60;
const BATCH = 40;

const DAY = 86400_000;

/** Whether an order should get its review request now. */
export function reviewDue(order: Order, now = Date.now()) {
  if (order.review_requested_at || order.email_status !== "sent" || (order.refunded_amount ?? 0) > 0 || order.cancelled_at) return false;
  if (now - Date.parse(order.created_at) > MAX_AGE_DAYS * DAY) return false;
  if ((order.kind ?? "digital") === "digital") return now - Date.parse(order.created_at) >= DIGITAL_DELAY_DAYS * DAY;
  if (order.delivered_at) return now - Date.parse(order.delivered_at) >= PHYSICAL_DELAY_DAYS * DAY;
  return !!order.shipped_at && now - Date.parse(order.shipped_at) >= SHIPPED_DELAY_DAYS * DAY;
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
const shortName = (name: string) => name.split(":")[0].trim();

export function buildReviewEmail(productName: string, link: string) {
  const name = shortName(productName);
  const stars = [5, 4, 3, 2, 1].map((rating) => `<a href="${escape(`${link}&rating=${rating}`)}" style="display:inline-block;margin:0 2px;font-size:28px;line-height:1;color:#F5B400;text-decoration:none" aria-label="${rating} stars">★</a>`).reverse().join("");
  return {
    subject: `How is ${name} working for you?`,
    html: `<div style="font-family:system-ui,sans-serif;color:#171717;line-height:1.6;max-width:560px">
<p>Hi,</p>
<p>A quick one: how are you finding <strong>${escape(name)}</strong>? A rating takes ten seconds and helps other people decide.</p>
<p style="margin:22px 0">${stars}</p>
<p><a style="color:#2B59FF" href="${escape(link)}">Leave a short review</a></p>
<p>If something isn't right, just reply to this email and we'll sort it out.</p>
<p>Frank<br>PodStore</p>
<p style="font-size:12px;color:#737373">We only ask once for each order.</p>
</div>`,
    text: `Hi,

A quick one: how are you finding ${name}? A rating takes ten seconds and helps other people decide.

Leave a review: ${link}

If something isn't right, just reply to this email and we'll sort it out.

Frank
PodStore

We only ask once for each order.`,
  };
}

function productNameFor(order: Order, products: Map<string, CatalogProduct>) {
  return products.get(order.product_id)?.name ?? order.physical_snapshot?.items?.[0]?.name ?? order.product_snapshot?.name ?? "your order";
}

/** Sends the review requests that are due. Each order is claimed before sending, so it's asked at most once. */
export async function sendReviewRequests(now = Date.now()) {
  const db = getSupabase();
  const since = new Date(now - MAX_AGE_DAYS * DAY).toISOString();
  const { data, error } = await db.from("orders").select("*").eq("store_id", STORE_ID).is("review_requested_at", null)
    .gte("created_at", since).order("created_at").limit(500);
  if (error) throw new Error("Could not load orders for review requests");
  const due = ((data ?? []) as Order[]).filter((order) => reviewDue(order, now)).slice(0, BATCH);
  if (!due.length) return { sent: 0, skipped: 0 };
  const { data: productRows } = await db.from("products").select("*").eq("store_id", STORE_ID).in("id", [...new Set(due.map((order) => order.product_id))]);
  const products = new Map(((productRows ?? []) as CatalogProduct[]).map((product) => [product.id, product]));
  const env = getEnv();
  const deployment = getDeployment();
  const resend = new Resend(env.RESEND_API_KEY);
  let sent = 0; let skipped = 0;
  for (const order of due) {
    const token = issueToken();
    const claimed = await db.from("orders").update({ review_requested_at: new Date(now).toISOString(), review_token_hash: token.hash })
      .eq("id", order.id).is("review_requested_at", null).select("id").maybeSingle();
    if (claimed.error || !claimed.data) { skipped += 1; continue; }
    if (!deployment.production && !emailAllowed(order.email, deployment.emailAllowlist)) { skipped += 1; continue; }
    const link = new URL("/review", env.APP_URL);
    link.searchParams.set("token", token.token);
    const message = buildReviewEmail(productNameFor(order, products), link.toString());
    const { error: sendError } = await resend.emails.send({
      from: "PodStore <orders@mail.veilcode.studio>", replyTo: "support@veilcode.studio", to: order.email, ...message,
      subject: deployment.production ? message.subject : `[${deployment.env === "preview" ? "Preview" : "Dev"}] ${message.subject}`,
    }, { idempotencyKey: `review-${order.id}`, signal: AbortSignal.timeout(15_000) }).catch(() => ({ error: true }));
    if (sendError) {
      // Release the claim so tomorrow's run tries again.
      await db.from("orders").update({ review_requested_at: null, review_token_hash: null }).eq("id", order.id);
      skipped += 1;
    } else sent += 1;
  }
  return { sent, skipped };
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The order behind a review link, its product, and any review already left. */
export async function reviewContext(token: unknown) {
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  const db = getSupabase();
  const { data: order } = await db.from("orders").select("*").eq("review_token_hash", hashToken(token)).maybeSingle();
  if (!order) return null;
  const found = order as Order;
  const [{ data: product }, { data: review }] = await Promise.all([
    db.from("products").select("*").eq("id", found.product_id).eq("store_id", found.store_id).maybeSingle(),
    db.from("reviews").select("*").eq("order_id", found.id).eq("store_id", found.store_id).maybeSingle(),
  ]);
  const catalog = product as CatalogProduct | null;
  const suggestedName = found.customer_name ? found.customer_name.trim().split(/\s+/).map((part, index) => index ? `${part[0]}.` : part).slice(0, 2).join(" ") : "";
  return { order: found, productName: catalog?.name ?? productNameFor(found, new Map()), productId: found.product_id, review: (review as Review | null) ?? null, suggestedName };
}

const clip = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().replace(/\s+\n/g, "\n").slice(0, max) : null;

/** Saves (or, while still waiting for approval, updates) the buyer's review. */
export async function submitReview(body: Record<string, unknown>) {
  const context = await reviewContext(body.token);
  if (!context) throw new HttpError(404, "This review link isn't valid. Reply to your order email and we'll help.");
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Choose from 1 to 5 stars.");
  const name = clip(body.name, 40);
  if (!name) throw new HttpError(400, "Add the name to show with your review, like “Sam K.”.");
  const values = { rating, title: clip(body.title, 80), body: clip(body.body, 2000), display_name: name, updated_at: new Date().toISOString() };
  const db = getSupabase();
  if (context.review) {
    if (context.review.status !== "pending") throw new HttpError(409, "Your review is already published. Thank you!");
    const { data, error } = await db.from("reviews").update(values).eq("id", context.review.id)
      .eq("store_id", context.order.store_id).eq("status", "pending").select("id").maybeSingle();
    if (error) throw new HttpError(500, "Could not save your review. Please try again.");
    if (!data) throw new HttpError(409, "Your review changed. Reload before editing it again.");
  } else {
    const { error } = await db.from("reviews").insert({ store_id: context.order.store_id, order_id: context.order.id, product_id: context.productId, status: "pending", ...values });
    if (error) throw new HttpError(500, "Could not save your review. Please try again.");
  }
  return { ok: true };
}

export async function listReviews(storeId = STORE_ID) {
  const { data, error } = await getSupabase().from("reviews").select("*").eq("store_id", storeId).order("created_at", { ascending: false }).limit(500);
  if (error) throw new HttpError(503, "Reviews are temporarily unavailable.");
  return (data ?? []) as Review[];
}

export async function setReviewStatus(body: Record<string, unknown>, storeId = STORE_ID) {
  if (typeof body.id !== "string" || !["approved", "hidden", "pending"].includes(String(body.status))) throw new HttpError(400, "Choose a review and what to do with it.");
  const status = body.status as Review["status"];
  const now = new Date().toISOString();
  const { data, error } = await getSupabase().from("reviews").update({ status, updated_at: now, approved_at: status === "approved" ? now : null })
    .eq("id", body.id).eq("store_id", storeId).select("*").maybeSingle();
  if (error) throw new HttpError(500, "Could not save the change.");
  if (!data) throw new HttpError(404, "That review no longer exists.");
  return data as Review;
}

/** Approved reviews for a product page, newest first, with the average. */
export async function approvedReviews(productId: string, storeId = STORE_ID) {
  const { data } = await getSupabase().from("reviews").select("id, rating, title, body, display_name, created_at")
    .eq("store_id", storeId).eq("product_id", productId).eq("status", "approved").order("created_at", { ascending: false }).limit(50);
  const reviews = (data ?? []) as PublicReview[];
  const average = reviews.length ? Math.round(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length * 10) / 10 : 0;
  return { reviews, count: reviews.length, average };
}
