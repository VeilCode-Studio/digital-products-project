import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetFakes, seedProduct, sendEmail, signUrl, state } from "./fakes";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: vi.fn(), delete: vi.fn() }) }));

import { POST as subscribeRoute } from "../app/api/subscribe/route";
import { GET as freeDownload } from "../app/api/free-download/route";
import { POST as unsubscribeRoute } from "../app/api/unsubscribe/route";
import { POST as adminRoute } from "../app/api/admin/subscribers/route";
import { GET as exportRoute } from "../app/api/admin/subscribers/export/route";
import { CONSENT_TEXT, currentGift } from "../lib/subscribers";

const ORIGIN = "https://delivery.example.com";
const post = (body: unknown) => subscribeRoute(new Request(`${ORIGIN}/api/subscribe`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }));
const admin = (body: unknown) => adminRoute(new Request(`${ORIGIN}/api/admin/subscribers`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }));
const linkIn = (call: number, path: string) => {
  const message = sendEmail.mock.calls[call][0] as { text: string };
  return new URL(message.text.match(new RegExp(`${ORIGIN}${path}\\?token=[A-Za-z0-9_-]+`))![0]);
};

function offerGift() {
  const gift = seedProduct({ slug: "checklist", name: "Launch Checklist: 30 steps", status: "draft", price_amount: null, stripe_price_id: null, storage_path: "store/checklist.pdf", download_filename: "Checklist.pdf" });
  (state.stores[0] as Record<string, unknown>).gift_product_id = gift.id;
  return gift;
}

beforeEach(() => { resetFakes(); jar.clear(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("the free download and email list", () => {
  it("only offers a download once the owner picks a product with a file", async () => {
    expect(await currentGift()).toBeNull();
    jar.set("veilcode_owner", "owner-token");
    const noFile = seedProduct({ storage_path: null });
    expect((await admin({ action: "gift", productId: noFile.id })).status).toBe(400);
    const gift = seedProduct({ storage_path: "store/guide.pdf", name: "Pricing Guide: the basics" });
    expect((await admin({ action: "gift", productId: gift.id })).status).toBe(200);
    expect(await currentGift()).toMatchObject({ id: gift.id, shortName: "Pricing Guide" });
    expect((await post({ email: "x@example.com" })).status).toBe(200);
    expect((await admin({ action: "gift", productId: null })).status).toBe(200);
    expect(await currentGift()).toBeNull();
  });

  it("emails a working download link, and records marketing consent only when ticked", async () => {
    const gift = offerGift();
    expect((await post({ email: " Reader@Example.com ", marketing: false })).status).toBe(200);
    expect(state.subscribers[0]).toMatchObject({ email: "reader@example.com", marketing_consent: false, consent_text: null, gift_product_id: gift.id });
    const first = sendEmail.mock.calls[0][0] as { to: string; subject: string; headers?: unknown; text: string };
    expect(first).toMatchObject({ to: "reader@example.com", subject: "Your free download: Launch Checklist" });
    expect(first.headers).toBeUndefined();
    expect(first.text).not.toContain("Unsubscribe");

    signUrl.mockResolvedValue({ data: { signedUrl: "https://files.example/checklist.pdf" }, error: null });
    const download = await freeDownload(new Request(linkIn(0, "/api/free-download")));
    expect(download.headers.get("location")).toBe("https://files.example/checklist.pdf");
    expect(state.subscribers[0].download_count).toBe(1);

    const fan = await post({ email: "fan@example.com", marketing: true });
    expect(fan.status).toBe(200);
    expect(state.subscribers[1]).toMatchObject({ marketing_consent: true, consent_text: CONSENT_TEXT });
    expect(state.subscribers[1].consented_at).toBeTruthy();
    const second = sendEmail.mock.calls[1][0] as { headers: Record<string, string>; text: string };
    expect(second.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(second.text).toContain(`${ORIGIN}/unsubscribe?token=`);
  });

  it("won't flood an inbox, ignores bots and rejects bad addresses", async () => {
    offerGift();
    await post({ email: "a@example.com" });
    await post({ email: "a@example.com" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((await post({ email: "bot@example.com", website: "http://spam" })).status).toBe(200);
    expect(state.subscribers.some((entry) => entry.email === "bot@example.com")).toBe(false);
    expect((await post({ email: "not-an-email" })).status).toBe(400);
  });

  it("unsubscribes with one click from a mail app, but never from merely opening the link", async () => {
    offerGift();
    await post({ email: "fan@example.com", marketing: true });
    const token = state.subscribers[0].unsubscribe_token as string;
    const response = await unsubscribeRoute(new Request(`${ORIGIN}/api/unsubscribe?token=${token}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
    expect(response.status).toBe(200);
    expect(state.subscribers[0]).toMatchObject({ marketing_consent: false });
    expect(state.subscribers[0].unsubscribed_at).toBeTruthy();

    // Ticking the box again later re-subscribes them, with fresh consent.
    state.subscribers[0].last_sent_at = null;
    await post({ email: "fan@example.com", marketing: true });
    expect(state.subscribers[0]).toMatchObject({ marketing_consent: true, unsubscribed_at: null });

    const page = await unsubscribeRoute(new Request(`${ORIGIN}/api/unsubscribe?token=${token}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "from=page" }));
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe(`${ORIGIN}/unsubscribe?done=1`);
  });

  it("shows shoppers exactly the consent wording that gets recorded", () => {
    expect(readFileSync("components/site/gift-signup.tsx", "utf8")).toContain(`const CONSENT = "${CONSENT_TEXT}";`);
  });

  it("exports the list with consent for the owner only", async () => {
    offerGift();
    await post({ email: "fan@example.com", marketing: true });
    expect((await exportRoute()).status).toBe(401);
    jar.set("veilcode_owner", "owner-token");
    const csv = await (await exportRoute()).text();
    expect(csv).toContain('"fan@example.com","yes"');
    expect(csv).toContain(CONSENT_TEXT);
  });
});
