import { describe, expect, it, vi } from "vitest";

const deleted = vi.hoisted(() => [] as string[]);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: (name: string) => deleted.push(name) }) }));

import { POST as logout } from "../app/api/admin/logout/route";

const ORIGIN = "https://delivery.example.com";
const post = (headers: Record<string, string>) => logout(new Request(`${ORIGIN}/api/admin/logout`, { method: "POST", headers }));

describe("signing out", () => {
  it("accepts the sign-out form a browser posts under the site's no-referrer policy", async () => {
    // Real browsers send Origin "null" for this form, and mark it same-origin themselves.
    const response = await post({ origin: "null", "sec-fetch-site": "same-origin" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/admin/login`);
    expect(deleted).toEqual(["veilcode_owner", "veilcode_owner_refresh"]);
  });
  it("still refuses a sign-out posted from another site", async () => {
    deleted.length = 0;
    expect((await post({ origin: "null", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect(deleted).toEqual([]);
  });
});
