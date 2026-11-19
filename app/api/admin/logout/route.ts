import { cookies } from "next/headers";
import { OWNER_COOKIE } from "@/lib/auth";
import { OWNER_REFRESH_COOKIE } from "@/lib/owner-session";
import { sameOriginForm, apiError } from "@/lib/http";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    sameOriginForm(req);
    const jar = await cookies();
    jar.delete(OWNER_COOKIE);
    jar.delete(OWNER_REFRESH_COOKIE);
    return Response.redirect(new URL("/admin/login", getEnv().APP_URL), 303);
  } catch (error) { return apiError(error); }
}
