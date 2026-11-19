import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetFakes, refreshSession, OWNER_ID } from "./fakes";
import { renewOwnerSession } from "../lib/owner-session";

const jwt = (secondsFromNow: number) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString("base64url")}.s`;
const owner = (cookies: Record<string, string>) => new NextRequest("https://delivery.example.com/admin", {
  headers: { cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") },
});
const fresh = { access_token: jwt(3600), refresh_token: "next-refresh", expires_in: 3600 };

beforeEach(() => { resetFakes(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("owner session renewal", () => {
  it("leaves a session with plenty of time alone", async () => {
    const response = await renewOwnerSession(owner({ veilcode_owner: jwt(1800), veilcode_owner_refresh: "r1" }));
    expect(refreshSession).not.toHaveBeenCalled();
    expect(response.cookies.getAll()).toEqual([]);
  });
  it("renews an expired session and passes the new token to this request", async () => {
    refreshSession.mockResolvedValueOnce({ data: { user: { id: OWNER_ID }, session: fresh }, error: null });
    const response = await renewOwnerSession(owner({ veilcode_owner_refresh: "r1" }));
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: "r1" });
    expect(response.cookies.get("veilcode_owner")).toMatchObject({ value: fresh.access_token, httpOnly: true, maxAge: 3600 });
    expect(response.cookies.get("veilcode_owner_refresh")).toMatchObject({ value: "next-refresh", httpOnly: true, maxAge: 60 * 60 * 24 * 30 });
    expect(response.headers.get("x-middleware-request-cookie") ?? response.headers.get("x-middleware-override-headers")).toBeTruthy();
  });
  it("renews a session that is about to run out", async () => {
    refreshSession.mockResolvedValueOnce({ data: { user: { id: OWNER_ID }, session: fresh }, error: null });
    await renewOwnerSession(owner({ veilcode_owner: jwt(120), veilcode_owner_refresh: "r1" }));
    expect(refreshSession).toHaveBeenCalledOnce();
  });
  it("drops a refresh token that Supabase refuses, or that belongs to someone else", async () => {
    refreshSession.mockResolvedValueOnce({ data: { user: null, session: null }, error: { status: 400, message: "Invalid Refresh Token" } });
    expect((await renewOwnerSession(owner({ veilcode_owner_refresh: "dead" }))).cookies.get("veilcode_owner_refresh")?.value).toBe("");
    refreshSession.mockResolvedValueOnce({ data: { user: { id: "someone-else" }, session: fresh }, error: null });
    const response = await renewOwnerSession(owner({ veilcode_owner_refresh: "other" }));
    expect(response.cookies.get("veilcode_owner")).toBeUndefined();
    expect(response.cookies.get("veilcode_owner_refresh")?.value).toBe("");
  });
  it("keeps the refresh token through a temporary outage", async () => {
    refreshSession.mockResolvedValueOnce({ data: { user: null, session: null }, error: { status: 503, message: "unavailable" } });
    expect((await renewOwnerSession(owner({ veilcode_owner_refresh: "r1" }))).cookies.getAll()).toEqual([]);
    refreshSession.mockRejectedValueOnce(new Error("fetch failed"));
    expect((await renewOwnerSession(owner({ veilcode_owner_refresh: "r1" }))).cookies.getAll()).toEqual([]);
  });
});
