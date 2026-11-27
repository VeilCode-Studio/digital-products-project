import "server-only";
import { getSupabase } from "./supabase";
import { getEnv, getDeployment } from "./env";
import { STORE_ID } from "./store-config";
import { HttpError } from "./http";
import { normalizeDomain, storefrontPath } from "./domain-rules";
import type { StoreDomain } from "./domain-types";
import type { CatalogProduct } from "./catalog.types";

export const domainsEnabled = () => process.env.CUSTOM_DOMAINS_ENABLED === "true";

export async function listDomains() {
  if (!domainsEnabled()) return [];
  const { data, error } = await getSupabase().from("store_domains").select("*").eq("store_id", STORE_ID).order("created_at");
  if (error) throw new HttpError(503, "Domain settings are unavailable. Check that the domains database update is installed.");
  return data;
}

export async function domainProduct(host: string) {
  if (!domainsEnabled()) return null;
  const hostname = normalizeDomain(host);
  if (!hostname) return null;
  const { data, error } = await getSupabase().from("store_domains").select("*").eq("store_id", STORE_ID).eq("hostname", hostname).eq("status", "active").maybeSingle();
  if (error) throw new HttpError(503, "Store domains are temporarily unavailable.");
  if (!data) return null;
  const product = await domainTarget(data.product_id);
  return product.status === "published" ? product : null;
}

export async function domainTarget(id: unknown, storeId = STORE_ID) {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,100}$/i.test(id)) throw new HttpError(404, "Choose an existing product or store.");
  const { data, error } = await getSupabase().from("products").select("*").eq("store_id", storeId).eq("id", id).maybeSingle();
  if (error) throw new HttpError(503, "Could not load the store.");
  if (!data) throw new HttpError(404, "Choose an existing product or store.");
  return data;
}

export async function primaryDomain(productId: string): Promise<StoreDomain | null> {
  if (!domainsEnabled()) return null;
  const { data, error } = await getSupabase().from("store_domains").select("*").eq("store_id", STORE_ID).eq("product_id", productId).eq("status", "active").maybeSingle();
  // Public platform pages remain usable during domain service outages.
  return error ? null : data;
}

export async function publicProductUrl(product: Pick<CatalogProduct, "id" | "slug" | "kind">) {
  const domain = await primaryDomain(product.id);
  return domain ? `https://${domain.hostname}/` : new URL(storefrontPath(product), getEnv().APP_URL).toString();
}

/** Admin and OAuth keep using sameOrigin(). Only shopper routes call this helper. */
export async function shopperOrigin(req: Request, productId?: string) {
  const origin = req.headers.get("origin");
  if (origin === new URL(getEnv().APP_URL).origin) return;
  const url = new URL(req.url);
  if (origin !== url.origin || url.protocol !== "https:") throw new HttpError(403, "Please submit this form from the store.");
  const product = await domainProduct(url.hostname);
  if (!product || (productId && product.id !== productId)) throw new HttpError(403, "Please submit this form from the store.");
}

/** Keep the deployment origin for webhook isolation; these URLs are only browser return destinations. */
export async function checkoutDestination(product: Pick<CatalogProduct, "id" | "slug" | "kind">) {
  const domain = await primaryDomain(product.id);
  const origin = domain ? `https://${domain.hostname}` : getEnv().APP_URL;
  const base = domain ? "" : storefrontPath(product);
  return { origin, base };
}

export function assertDomainName(value: unknown) {
  const hostname = normalizeDomain(value);
  const protectedHosts = [getEnv().APP_URL, process.env.PRODUCTION_APP_URL].filter(Boolean).map((url) => new URL(url!).hostname);
  if (!hostname || protectedHosts.some((host) => hostname === host || host.endsWith(`.${hostname}`) || hostname.endsWith(`.${host}`))) {
    throw new HttpError(400, "Enter a domain such as mybrand.com or shop.mybrand.com, without https:// or a path. Platform domains cannot be connected.");
  }
  return hostname;
}

export function domainBranch() {
  const deployment = getDeployment();
  if (deployment.production) return null;
  const branch = process.env.DOMAIN_PREVIEW_BRANCH?.trim();
  if (!branch) throw new HttpError(503, "Set the staging branch before connecting domains in this environment.");
  return branch;
}
