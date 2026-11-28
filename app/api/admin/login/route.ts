import { cookies } from "next/headers";
import { authClient, getOwnerId, allowedWorkspaceUser } from "@/lib/auth";
import { workspaceForUser, provisionWorkspace } from "@/lib/workspace";
import { ownerSessionCookies } from "@/lib/owner-session";
import { sameOrigin, apiError, HttpError, jsonObject } from "@/lib/http";
import { getSupabase } from "@/lib/supabase";
import { STORE_ID } from "@/lib/store-config";

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = await jsonObject(req);
    if (typeof body.email !== "string" || typeof body.password !== "string" || body.email.length > 254 || body.password.length > 1024) throw new HttpError(400, "Enter your email and password.");
    const ownerId = getOwnerId();
    const client = authClient();
    const { data, error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error || !data.session || !allowedWorkspaceUser(data.user)) {
      if (data.session) await client.auth.signOut();
      throw new HttpError(401, "Email or password is incorrect, or this account cannot manage the store.");
    }
    if (data.user.id === ownerId) {
      // Legacy bootstrap may claim only an unowned original store, never reassign one.
      const { error: storeError } = await getSupabase().from("stores").update({ owner_user_id: ownerId }).eq("id", STORE_ID).is("owner_user_id", null);
      if (storeError) throw new HttpError(503, "The store is not ready. Apply the storefront migration first.");
    }
    try { await workspaceForUser(data.user.id); }
    catch (error) {
      if (!(error instanceof HttpError) || error.status !== 403) throw error;
      await provisionWorkspace(data.user, data.user.user_metadata?.store_name ?? "My store");
    }
    // The refresh cookie lets proxy.ts renew the hour-long session, so the owner stays signed in.
    const jar = await cookies();
    for (const [name, value, options] of ownerSessionCookies(data.session)) jar.set(name, value, options);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
