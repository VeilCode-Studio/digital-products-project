import { after } from "next/server";
import { handleCjNotification, validWebhookKey } from "@/lib/cj-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 256 * 1024;

/**
 * CJ's notifications (lib/cj-webhooks.ts). CJ wants a 200 within 3 seconds, never retries, and turns a
 * topic off when fewer than 80% succeed, so this answers at once and does the work after responding.
 * Its own test call (sent before CJ saves the address) gets the same quick 200.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/webhooks/cj/[key]">) {
  const { key } = await ctx.params;
  if (!validWebhookKey(key)) return new Response("Not found", { status: 404 });
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ ok: false }, { status: 413 });
  let payload: unknown = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { return Response.json({ ok: true }); }
  if (payload) {
    after(async () => {
      try { await handleCjNotification(payload); } catch (error) {
        console.error("CJ notification failed", error instanceof Error ? error.message.slice(0, 160) : "");
      }
    });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
