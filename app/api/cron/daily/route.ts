import { timingSafeEqual } from "node:crypto";
import { sendReviewRequests } from "@/lib/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The once-a-day job (vercel.json crons). Vercel calls it with "Authorization: Bearer <CRON_SECRET>";
 * without that secret configured it refuses to run. Each task runs on its own, so one failing never
 * stops the others.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const results: Record<string, unknown> = {};
  const tasks: [string, () => Promise<unknown>][] = [["reviewRequests", () => sendReviewRequests()]];
  for (const [name, task] of tasks) {
    try { results[name] = await task(); }
    catch (error) { console.error(`Daily task failed: ${name}`, error instanceof Error ? error.message.slice(0, 200) : ""); results[name] = { error: true }; }
  }
  return Response.json({ ok: true, results }, { headers: { "Cache-Control": "no-store" } });
}
