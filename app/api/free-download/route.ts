import { getEnv } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";
import { consumeGiftDownload } from "@/lib/subscribers";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** The link in the free download email: one counted use, then a short-lived signed file URL. */
export async function GET(req: Request) {
  const env = getEnv();
  const invalid = () => new Response(null, { status: 302, headers: { ...headers, Location: new URL("/download-error", env.APP_URL).toString() } });
  const token = new URL(req.url).searchParams.get("token");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return invalid();
  try {
    const product = await consumeGiftDownload(token);
    if (!product?.storage_path) return invalid();
    const { data, error } = await getSupabase().storage.from(env.SUPABASE_BUCKET)
      .createSignedUrl(product.storage_path, 60, { download: product.download_filename ?? undefined });
    if (error || !data?.signedUrl) throw new Error("Could not sign download");
    return new Response(null, { status: 302, headers: { ...headers, Location: data.signedUrl } });
  } catch {
    console.error("Free download failed");
    return Response.json({ error: "Download unavailable. Please try again shortly." }, { status: 503, headers });
  }
}
