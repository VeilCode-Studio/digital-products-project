import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, state, getUser, signIn, signUp, setSession, updateUser, rpc } from "./fakes";
import { onboardingEnabled } from "../lib/onboarding-mode";
import { provisionWorkspace } from "../lib/workspace";
import { stubDevelopment } from "./env";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined, set: (key: string, value: string) => jar.set(key, value) }) }));
import { POST as auth } from "../app/api/auth/[action]/route";
import { POST as login } from "../app/api/admin/login/route";
const user = (extra: Partial<User> = {}) => ({ id: randomUUID(), email: "merchant@example.com", email_confirmed_at: new Date().toISOString(), is_anonymous: false, user_metadata: { store_name: "Merchant store", store_id: state.stores[0].id }, ...extra }) as User;
const session = { access_token: "verified-token", refresh_token: "verified-refresh", expires_in: 3600 };
const request = (body: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/auth/signup", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const action = (name: string, body: unknown) => auth(request(body), { params: Promise.resolve({ action: name }) });
beforeEach(() => { resetFakes(); jar.clear(); stubDevelopment(); vi.stubEnv("WORKSPACE_ONBOARDING_ENABLED", "true"); });
it("keeps production signup closed without its separate opt-in", () => {
  expect(onboardingEnabled({ DEPLOYMENT_ENV: "production", WORKSPACE_ONBOARDING_ENABLED: "true" })).toBe(false);
  expect(onboardingEnabled({ DEPLOYMENT_ENV: "preview", WORKSPACE_ONBOARDING_ENABLED: "true" })).toBe(true);
});
it("requires verification before creating a workspace and ignores store IDs in editable metadata", async () => {
  const original = structuredClone(state.stores[0]); const merchant = user();
  await expect(provisionWorkspace({ ...merchant, email_confirmed_at: undefined }, "Merchant")).rejects.toMatchObject({ status: 403 });
  expect(rpc).not.toHaveBeenCalled();
  const [first, repeated] = await Promise.all([provisionWorkspace(merchant, "Merchant"), provisionWorkspace(merchant, "Merchant")]);
  expect(first).toEqual(repeated); expect(first.storeId).not.toBe(original.id);
  expect(state.stores).toHaveLength(2); expect(state.stores[0]).toEqual(original);
});
it("keeps workspaces separate for two verified accounts", async () => {
  const [a, b] = [user(), user({ email: "second@example.com" })];
  const first = await provisionWorkspace(a, "First"); const second = await provisionWorkspace(b, "Second");
  expect(first.storeId).not.toBe(second.storeId); expect(first.ownerId).toBe(a.id); expect(second.ownerId).toBe(b.id);
});
it("creates signup verification with a fixed redirect and does not provision an unverified signup", async () => {
  const response = await action("signup", { name: "New merchant", email: "new@example.com", password: "a-long-new-password", storeId: state.stores[0].id });
  expect(response.status).toBe(200); expect(state.stores).toHaveLength(1); expect(jar.size).toBe(0);
  expect(signUp).toHaveBeenCalledWith({ email: "new@example.com", password: "a-long-new-password", options: { emailRedirectTo: "http://localhost:3000/auth/confirm", data: { store_name: "New merchant" } } });
});
it("verifies the confirmation session on the server before saving cookies or provisioning", async () => {
  const merchant = user(); setSession.mockResolvedValue({ data: { user: merchant, session }, error: null });
  getUser.mockResolvedValue({ data: { user: { ...merchant, email_confirmed_at: null } }, error: null });
  expect((await action("session", session)).status).toBe(401); expect(state.stores).toHaveLength(1); expect(jar.size).toBe(0);
  getUser.mockResolvedValue({ data: { user: merchant }, error: null });
  expect((await action("session", session)).status).toBe(200);
  expect(jar.get("veilcode_owner")).toBe(session.access_token); expect(state.stores[1].owner_user_id).toBe(merchant.id);
});
it("allows verified merchant login without rebinding the original store", async () => {
  const original = structuredClone(state.stores[0]); const merchant = user();
  signIn.mockResolvedValue({ data: { user: merchant, session }, error: null });
  expect((await login(request({ email: merchant.email, password: "a-long-password", storeId: original.id }))).status).toBe(200);
  expect(state.stores[0]).toEqual(original); expect(state.stores[1].owner_user_id).toBe(merchant.id);
});
it("does not let legacy login steal a store that is already assigned to someone else", async () => {
  const otherOwner = randomUUID(); state.stores[0].owner_user_id = otherOwner;
  signIn.mockResolvedValue({ data: { user: { id: OWNER_ID }, session }, error: null });
  vi.stubEnv("WORKSPACE_ONBOARDING_ENABLED", "false");
  expect((await login(request({ email: "owner@example.com", password: "password" }))).status).toBe(403);
  expect(state.stores[0].owner_user_id).toBe(otherOwner);
});
it("requires a verified reset session and a strong password before changing it", async () => {
  expect((await action("reset", { ...session, password: "a-long-password" })).status).toBe(401); expect(updateUser).not.toHaveBeenCalled();
  const merchant = user(); setSession.mockResolvedValue({ data: { user: merchant, session }, error: null }); getUser.mockResolvedValue({ data: { user: merchant }, error: null });
  expect((await action("reset", { ...session, password: "short" })).status).toBe(400); expect(updateUser).not.toHaveBeenCalled();
  expect((await action("reset", { ...session, password: "a-strong-reset-password" })).status).toBe(200);
  expect(updateUser).toHaveBeenCalledWith({ password: "a-strong-reset-password" });
});
it("rejects a foreign-origin signup before calling Auth", async () => {
  const response = await auth(request({ email: "new@example.com" }, "https://foreign.example.com"), { params: Promise.resolve({ action: "signup" }) });
  expect(response.status).toBe(403); expect(signUp).not.toHaveBeenCalled();
});
