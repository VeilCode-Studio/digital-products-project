import type { NextRequest } from "next/server";
import { renewOwnerSession } from "@/lib/owner-session";

/** Keeps the owner signed in: renews the hour-long session before it runs out. Pages still check access themselves. */
export function proxy(request: NextRequest) {
  return renewOwnerSession(request);
}

export const config = {
  matcher: [{
    // Only the owner's browser carries the refresh cookie, so shoppers never pay for this.
    source: "/((?!_next/static|_next/image|brand/|favicon.ico|icon.svg|apple-icon.png).*)",
    has: [{ type: "cookie", key: "veilcode_owner_refresh" }],
  }],
};
