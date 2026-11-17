import "server-only";
import { redirect } from "next/navigation";
import { ownerUser } from "./auth";

/**
 * A draft store is only visible to its signed-in owner. Sessions last an hour, so an owner opening
 * a preview link after that would otherwise get a bare 404: send them to sign in, then back here.
 * Anyone else ends up on the sign-in page too, which tells them nothing about whether the draft exists.
 */
export async function signInForPreview(path: string) {
  if (await ownerUser()) return;
  redirect(`/admin/login?next=${encodeURIComponent(path)}`);
}

/** The path and preview query a store page was asked for, for coming back after sign-in. */
export function previewPath(path: string, query: Record<string, string | string[] | undefined>) {
  return `${path}?preview=1${query.draft === "1" ? "&draft=1" : ""}`;
}
