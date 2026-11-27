import "server-only";
import { cache } from "react";
import { requireOwner } from "./auth";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";

/** Resolve ownership from the database. Browser parameters and editable user metadata never select a workspace. */
export async function workspaceForUser(userId: string) {
  const { data, error } = await getSupabase().from("stores").select("id,owner_user_id")
    .eq("owner_user_id", userId).maybeSingle();
  if (error) throw new HttpError(503, "Your workspace could not be verified. Please try again.");
  if (!data) throw new HttpError(403, "Your account does not have a workspace yet.");
  return { storeId: data.id, ownerId: userId };
}

/** The existing owner-only sign-in gate stays in place until every management path is isolated. */
export const requireWorkspace = cache(async function requireWorkspace() {
  const user = await requireOwner();
  return { user, ...await workspaceForUser(user.id) };
});
