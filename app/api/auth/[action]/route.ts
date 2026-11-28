import { cookies } from "next/headers";
import { authClient, allowedWorkspaceUser, getOwnerId } from "@/lib/auth";
import { onboardingEnabled } from "@/lib/onboarding-mode";
import { getEnv } from "@/lib/env";
import { sameOrigin, jsonObject, apiError, HttpError } from "@/lib/http";
import { provisionWorkspace, workspaceForUser } from "@/lib/workspace";
import { ownerSessionCookies } from "@/lib/owner-session";

export const runtime = "nodejs";
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    sameOrigin(req);
    const { action } = await params;
    if (!onboardingEnabled() && action !== "recover" && action !== "reset") throw new HttpError(404, "Account creation is not open yet.");
    const body = await jsonObject(req, 12_000);
    const client = authClient();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const validEmail = email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
    const password = typeof body.password === "string" ? body.password : "";
    if (action === "signup") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!validEmail || password.length < 12 || password.length > 128 || !name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400, "Add a store name, valid email, and a password of 12 to 128 characters.");
      const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: `${getEnv().APP_URL}/auth/confirm`, data: { store_name: name } } });
      if (error && error.code !== "user_already_exists") throw new HttpError(400, "Account creation could not be completed. Check your details or try again shortly.");
      return Response.json({ ok: true, message: "Check your email to verify your account, then sign in." }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "recover") {
      if (!validEmail) throw new HttpError(400, "Enter a valid email address.");
      await client.auth.resetPasswordForEmail(email, { redirectTo: `${getEnv().APP_URL}/auth/reset` });
      return Response.json({ ok: true, message: "If this account exists, a password reset link is on its way." }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action !== "session" && action !== "reset") throw new HttpError(404, "Account action not found.");
    if (typeof body.access_token !== "string" || typeof body.refresh_token !== "string") throw new HttpError(400, "This link has expired. Request a new one.");
    const { data, error } = await client.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    const verified = !error && data.session ? await client.auth.getUser(data.session.access_token) : null;
    if (!verified || verified.error || !allowedWorkspaceUser(verified.data.user) || !data.session) throw new HttpError(401, "This link has expired. Request a new one.");
    const user = verified.data.user!;
    if (action === "reset") {
      if (password.length < 12 || password.length > 128) throw new HttpError(400, "Use a password of 12 to 128 characters.");
      const changed = await client.auth.updateUser({ password });
      if (changed.error) throw new HttpError(400, "The password could not be updated. Use a different password or request a new link.");
    }
    if (user.id !== getOwnerId()) await provisionWorkspace(user, user.user_metadata?.store_name ?? "My store");
    else await workspaceForUser(user.id);
    const jar = await cookies();
    for (const [name, value, options] of ownerSessionCookies(data.session)) jar.set(name, value, options);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
