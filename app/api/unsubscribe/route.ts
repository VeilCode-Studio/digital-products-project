import { getEnv } from "@/lib/env";
import { unsubscribe } from "@/lib/subscribers";

export const runtime = "nodejs";

/**
 * Unsubscribe. Mail apps send a one-click POST (RFC 8058, body "List-Unsubscribe=One-Click"); the
 * /unsubscribe page's button posts a form and is sent back to the page. A GET never unsubscribes,
 * so link scanners that open every URL in an email can't take anyone off the list.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  try { await unsubscribe(token); }
  catch { return new Response("Please try again shortly.", { status: 503, headers: { "Cache-Control": "no-store" } }); }
  const form = await req.formData().catch(() => null);
  if (form?.get("from") === "page") {
    const back = new URL("/unsubscribe", getEnv().APP_URL);
    back.searchParams.set("done", "1");
    return new Response(null, { status: 303, headers: { Location: back.toString(), "Cache-Control": "no-store" } });
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
