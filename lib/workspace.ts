import "server-only";
import { cache } from "react";
import { requireOwner } from "./auth";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import type { User } from "@supabase/supabase-js";
import { onboardingEnabled } from "./onboarding-mode";

/** Resolve ownership from the database. Browser parameters and editable user metadata never select a workspace. */
export async function workspaceForUser(userId: string) {
  const { data, error } = await getSupabase().from("stores").select("id,owner_user_id")
    .eq("owner_user_id", userId).maybeSingle();
  if (error) throw new HttpError(503, "Your workspace could not be verified. Please try again.");
  if (!data) throw new HttpError(403, "Your account does not have a workspace yet.");
  return { storeId: data.id, ownerId: userId };
}

export async function provisionWorkspace(user: User, name: unknown) {
  if (!onboardingEnabled() || !user.email_confirmed_at || !user.email || user.is_anonymous) throw new HttpError(403, "Verify your email before creating a workspace.");
  const title = typeof name === "string" ? name.trim() : "My store";
  if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title)) throw new HttpError(400, "Use a store name of 1 to 80 characters.");
  const { data, error } = await getSupabase().rpc("provision_workspace", { p_user_id: user.id, p_name: title, p_email: user.email });
  if (error || !data) throw new HttpError(503, "Your workspace could not be created. Please try signing in again.");
  return workspaceForUser(user.id);
}

/** All management paths select the store through verified database ownership. */
export const requireWorkspace = cache(async function requireWorkspace() {
  const user = await requireOwner();
  return { user, ...await workspaceForUser(user.id) };
});
