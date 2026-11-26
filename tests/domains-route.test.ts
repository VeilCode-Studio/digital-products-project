import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "../app/api/admin/domains/route";
import { resetFakes } from "./fakes";
import { stubDevelopment } from "./env";

const session = vi.hoisted(() => ({ token: "owner-token" as string | null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => session.token ? { value: session.token } : undefined }) }));
beforeEach(() => { resetFakes(); session.token = "owner-token"; vi.stubGlobal("fetch", vi.fn()); });
const request = (action: string, origin = "https://delivery.example.com") => new Request(`${origin}/api/admin/domains`, {
  method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ action, hostname: "mybrand.com", expectedPrice: 12 }),
});
it("requires owner authentication for domain actions", async () => {
  session.token = null;
  expect((await POST(request("search"))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it("requires the platform Origin for domain management", async () => {
  expect((await POST(request("connect", "https://evil.com"))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects production domain search and rehearsal even when the preview flag is enabled", async () => {
  vi.stubEnv("DOMAIN_PURCHASE_PREVIEW", "true");
  expect((await POST(request("search"))).status).toBe(404);
  expect((await POST(request("rehearse"))).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it("completes a staging rehearsal without purchase or payment calls", async () => {
  stubDevelopment({ DOMAIN_PURCHASE_PREVIEW: "true" });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results: [{ domain: "mybrand.com", available: true, years: 1, price: 12, renewalPrice: 15, premium: false }] }));
  const response = await POST(request("rehearse", "http://localhost:3000"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ simulated: true, registered: false, charged: false });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://api.vercel.com/v1/registrar/domains/search");
});
