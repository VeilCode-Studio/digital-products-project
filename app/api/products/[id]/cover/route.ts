import { getCatalogProduct, getPublishedProductById } from "@/lib/catalog";
import { getSupabase } from "@/lib/supabase";
import { getEnv } from "@/lib/env";
import { ownerUser } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { STORE_ID } from "@/lib/store-config";

export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const preview = new URL(req.url).searchParams.get("preview") === "1";
    const id = (await ctx.params).id;
    const owner = preview ? await ownerUser() : null;
    if (preview && !owner) return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const workspace = owner ? await workspaceForUser(owner.id) : null;
    const product = workspace ? await getCatalogProduct(id, workspace.storeId) : await getPublishedProductById(id);
    const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    if (!product || !product.cover_path || !["image/png", "image/jpeg", "image/webp"].includes(product.cover_type ?? "")) return missing();
    if (product.store_id !== STORE_ID && !product.cover_path.startsWith(`${product.store_id}/${product.id}/covers/`)) return missing();
    const { data, error } = await getSupabase().storage.from(getEnv().SUPABASE_BUCKET).download(product.cover_path);
    if (error || !data) return new Response(null, { status: 404 });
    return new Response(data, { headers: { "Content-Type": product.cover_type!, "X-Content-Type-Options": "nosniff", "Cache-Control": preview ? "private, no-store" : "public, max-age=60", ...(preview ? { Vary: "Cookie" } : {}) } });
  } catch { return new Response(null, { status: 503 }); }
}
