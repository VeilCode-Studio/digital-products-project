import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authClient, getOwnerId, OWNER_COOKIE } from "./auth";
import { getEnv } from "./env";

/** Long-lived and HTTP-only: it only ever buys a fresh hour-long access token for the owner. */
export const OWNER_REFRESH_COOKIE = "veilcode_owner_refresh";
/** Staying away this long signs the owner out; every renewal pushes it back. */
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;
/** Renew a little before the access token runs out, so a page never renders with a dead one. */
const RENEW_WITHIN_SECONDS = 5 * 60;

type Session = { access_token: string; refresh_token: string; expires_in: number };
type CookieOptions = { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };

/** The two owner cookies for a session, with the options both sign-in and renewal set them with. */
export function ownerSessionCookies(session: Session): [string, string, CookieOptions][] {
  const base = { httpOnly: true, secure: new URL(getEnv().APP_URL).protocol === "https:", sameSite: "lax", path: "/" } as const;
  return [
    [OWNER_COOKIE, session.access_token, { ...base, maxAge: Math.min(session.expires_in, 3600) }],
    [OWNER_REFRESH_COOKIE, session.refresh_token, { ...base, maxAge: REFRESH_MAX_AGE }],
  ];
}

/** Seconds until a Supabase access token expires, read from its claims (verification happens elsewhere). */
function secondsLeft(token: string | undefined, now = Date.now()) {
  if (!token) return 0;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp - now / 1000 : 0;
  } catch { return 0; }
}

/**
 * Runs before owner requests. When the access token is missing or about to expire, trades the refresh
 * token for a new session and hands it both to this request (so the page sees it) and to the browser.
 */
export async function renewOwnerSession(request: NextRequest) {
  const refreshToken = request.cookies.get(OWNER_REFRESH_COOKIE)?.value;
  if (!refreshToken || secondsLeft(request.cookies.get(OWNER_COOKIE)?.value) > RENEW_WITHIN_SECONDS) return NextResponse.next();
  try {
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session || data.user?.id !== getOwnerId()) {
      const response = NextResponse.next();
      // A refused token is gone for good; a network or server hiccup keeps it for the next request.
      if (!error || (error.status ?? 500) < 500) response.cookies.delete(OWNER_REFRESH_COOKIE);
      return response;
    }
    const cookies = ownerSessionCookies(data.session);
    for (const [name, value] of cookies) request.cookies.set(name, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    for (const [name, value, options] of cookies) response.cookies.set(name, value, options);
    return response;
  } catch (error) {
    console.error("Owner session renewal failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : "");
    return NextResponse.next();
  }
}
