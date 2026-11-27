import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { OWNER_ID, resetFakes, seedProduct, state } from "./fakes";
import { STORE_ID } from "../lib/store-config";
import { workspaceForUser } from "../lib/workspace";
import { listDomains } from "../lib/domains";
import { listProducts } from "../lib/catalog";
import { checkDomain, connectDomain, removeDomain } from "../lib/domain-provider";

const otherStore = "5e46ab45-1909-4087-81f2-1004d7c46689";
const otherOwner = "223b175d-2a62-4af7-9bcc-6747c9f29d42";
beforeEach(() => {
  resetFakes();
  state.stores.push({ ...state.stores[0], id: otherStore, owner_user_id: otherOwner, name: "Other workspace" });
  vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "true");
  vi.stubEnv("DOMAIN_VERCEL_TOKEN", "provider-test-token");
  vi.stubEnv("DOMAIN_VERCEL_PROJECT_ID", "project-test");
  vi.stubEnv("DOMAIN_VERCEL_TEAM_ID", "team-test");
  vi.stubGlobal("fetch", vi.fn());
});
it("resolves each workspace through its database owner and refuses missing ownership or a failed lookup", async () => {
  expect(await workspaceForUser(OWNER_ID)).toEqual({ ownerId: OWNER_ID, storeId: STORE_ID });
  expect(await workspaceForUser(otherOwner)).toEqual({ ownerId: otherOwner, storeId: otherStore });
  await expect(workspaceForUser(randomUUID())).rejects.toMatchObject({ status: 403 });
  state.dbError = true;
  await expect(workspaceForUser(OWNER_ID)).rejects.toMatchObject({ status: 503 });
});
it("does not substitute the original store when a verified owner's store has another ID", async () => {
  state.stores[0].owner_user_id = null;
  state.stores[1].owner_user_id = OWNER_ID;
  expect(await workspaceForUser(OWNER_ID)).toEqual({ ownerId: OWNER_ID, storeId: otherStore });
});
it("lists products and domains only within the explicit workspace", async () => {
  const first = seedProduct();
  const second = seedProduct({ store_id: otherStore });
  for (const [product, hostname] of [[first, "first-brand.com"], [second, "second-brand.com"]] as const) state.store_domains.push({
    id: randomUUID(), store_id: product.store_id, product_id: product.id, hostname, status: "pending", verification: [], checked_at: null, created_at: new Date().toISOString(),
  });
  expect((await listProducts(false, undefined, otherStore)).map((p) => p.id)).toEqual([second.id]);
  expect((await listDomains(otherStore)).map((d) => d.hostname)).toEqual(["second-brand.com"]);
  expect((await listDomains(STORE_ID)).map((d) => d.hostname)).toEqual(["first-brand.com"]);
});
it("rejects another workspace's product and domain before any provider mutation", async () => {
  const product = seedProduct({ store_id: otherStore });
  const domain = { id: randomUUID(), store_id: otherStore, product_id: product.id, hostname: "other-brand.com", status: "active" as const, verification: [], checked_at: null, created_at: new Date().toISOString() };
  state.store_domains.push(domain);
  await expect(connectDomain(product.id, domain.hostname, STORE_ID)).rejects.toMatchObject({ status: 404 });
  await expect(checkDomain(domain.id, STORE_ID)).rejects.toMatchObject({ status: 404 });
  await expect(removeDomain(domain.id, STORE_ID)).rejects.toMatchObject({ status: 404 });
  expect(fetch).not.toHaveBeenCalled();
  expect(state.store_domains[0]).toEqual(domain);
});
