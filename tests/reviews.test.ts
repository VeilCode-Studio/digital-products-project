import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedOrder, seedProduct, sendEmail, state } from "./fakes";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));

import { GET as cron } from "../app/api/cron/daily/route";
import { POST as reviewRoute } from "../app/api/reviews/route";
import { POST as adminRoute } from "../app/api/admin/reviews/route";
import { approvedReviews, reviewContext, reviewDue, sendReviewRequests } from "../lib/reviews";
import { digitalProductLd } from "../lib/seo";
import type { Order } from "../lib/database.types";

const ORIGIN = "https://delivery.example.com";
const DAY = 86400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const json = (url: string, body: unknown) => new Request(`${ORIGIN}${url}`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const tokenFromEmail = (call = 0) => new URL((sendEmail.mock.calls[call][0] as { text: string }).text.match(/https:\/\/\S+\/review\?token=\S+/)![0]).searchParams.get("token")!;

beforeEach(() => { resetFakes(); jar.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("review requests", () => {
  it("asks at the right moment, and never for refunded, cancelled or old orders", () => {
    const base = { email_status: "sent", review_requested_at: null } as Partial<Order>;
    const order = (overrides: Partial<Order>) => ({ ...base, created_at: ago(1), ...overrides }) as Order;
    expect(reviewDue(order({ created_at: ago(6) }))).toBe(true);
    expect(reviewDue(order({ created_at: ago(2) }))).toBe(false);
    expect(reviewDue(order({ created_at: ago(6), refunded_amount: 100 }))).toBe(false);
    expect(reviewDue(order({ created_at: ago(90) }))).toBe(false);
    expect(reviewDue(order({ created_at: ago(6), review_requested_at: ago(1) }))).toBe(false);
    expect(reviewDue(order({ kind: "physical", created_at: ago(20), delivered_at: ago(5) }))).toBe(true);
    expect(reviewDue(order({ kind: "physical", created_at: ago(20), delivered_at: ago(1) }))).toBe(false);
    expect(reviewDue(order({ kind: "physical", created_at: ago(20), shipped_at: ago(13) }))).toBe(true);
    expect(reviewDue(order({ kind: "physical", created_at: ago(20), shipped_at: ago(13), cancelled_at: ago(14) }))).toBe(false);
  });

  it("sends each due order one email, even across runs", async () => {
    const product = seedProduct({ name: "Studio Kit: the full system" });
    seedOrder({ product_id: product.id, email_status: "sent", created_at: ago(6), stripe_session_id: "cs_1" });
    seedOrder({ product_id: product.id, email_status: "sent", created_at: ago(1), stripe_session_id: "cs_2", download_token_hash: "b".repeat(64) });
    expect(await sendReviewRequests()).toEqual({ sent: 1, skipped: 0 });
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: "buyer@example.com", subject: "How is Studio Kit working for you?" });
    expect(await sendReviewRequests()).toEqual({ sent: 0, skipped: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("runs only for Vercel's scheduler", async () => {
    const call = (auth?: string) => cron(new Request(`${ORIGIN}/api/cron/daily`, { headers: auth ? { authorization: auth } : {} }));
    expect((await call("Bearer anything")).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call("Bearer wrong")).status).toBe(401);
    const ok = await call("Bearer s3cret-value");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, results: { reviewRequests: { sent: 0 } } });
  });
});

describe("leaving and publishing reviews", () => {
  it("takes a verified review, lets the buyer edit it until it's published, then shows it with a rating", async () => {
    const product = seedProduct({ slug: "kit" });
    seedOrder({ product_id: product.id, email_status: "sent", created_at: ago(6), customer_name: "Samantha Kerr Jones" });
    await sendReviewRequests();
    const token = tokenFromEmail();
    expect((await reviewContext(token))?.suggestedName).toBe("Samantha K.");

    expect((await reviewRoute(json("/api/reviews", { token, rating: 6, name: "Sam" }))).status).toBe(400);
    expect((await reviewRoute(json("/api/reviews", { token, rating: 5 }))).status).toBe(400);
    expect((await reviewRoute(json("/api/reviews", { token: "x".repeat(43), rating: 5, name: "Sam" }))).status).toBe(404);
    expect((await reviewRoute(json("/api/reviews", { token, rating: 4, name: "Sam K.", body: "Useful." }))).status).toBe(200);
    expect((await reviewRoute(json("/api/reviews", { token, rating: 5, name: "Sam K.", title: "Great", body: "Really useful." }))).status).toBe(200);
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0]).toMatchObject({ rating: 5, status: "pending", title: "Great", product_id: product.id });
    expect((await approvedReviews(product.id)).count).toBe(0);

    expect((await adminRoute(json("/api/admin/reviews", { action: "status", id: state.reviews[0].id, status: "approved" }))).status).toBe(401);
    jar.set("veilcode_owner", "owner-token");
    expect((await adminRoute(json("/api/admin/reviews", { action: "status", id: state.reviews[0].id, status: "approved" }))).status).toBe(200);
    expect((await reviewRoute(json("/api/reviews", { token, rating: 1, name: "Sam K." }))).status).toBe(409);

    const ratings = await approvedReviews(product.id);
    expect(ratings).toMatchObject({ count: 1, average: 5 });
    expect(digitalProductLd(product, ratings)).toMatchObject({ aggregateRating: { ratingValue: "5.0", reviewCount: 1 }, review: [{ author: { name: "Sam K." }, reviewBody: "Really useful." }] });
    expect(digitalProductLd(product, { reviews: [], count: 0, average: 0 })).not.toHaveProperty("aggregateRating");
  });
});
