import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { assertDomainName, domainBranch, domainsEnabled, domainTarget } from "./domains";
import { domainPurchasePreview } from "./domain-rules";
import { getDeployment } from "./env";
import type { DnsRecord, DomainQuote } from "./domain-types";

type ProjectDomain = { name: string; apexName: string; verified: boolean; gitBranch?: string | null; verification?: { type: string; domain: string; value: string }[] };
type DomainConfig = { misconfigured: boolean; recommendedCNAME: { rank: number; value: string }[]; recommendedIPv4: { rank: number; value: string[] }[] };
type Certificate = { cns: string[]; expiresAt: number };

export function domainConnectionReady() {
  return domainsEnabled() && !!process.env.DOMAIN_VERCEL_TOKEN && !!process.env.DOMAIN_VERCEL_PROJECT_ID && !!process.env.DOMAIN_VERCEL_TEAM_ID;
}

async function vercel<T>(path: string, method = "GET", body?: object): Promise<T> {
  if (!domainConnectionReady()) throw new HttpError(503, "Domain connections need to be configured for this environment.");
  const url = new URL(path, "https://api.vercel.com");
  url.searchParams.set("teamId", process.env.DOMAIN_VERCEL_TEAM_ID!);
  const response = await fetch(url, {
    method, headers: { Authorization: `Bearer ${process.env.DOMAIN_VERCEL_TOKEN}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new HttpError(503, "The domain provider did not respond. Check status before trying again."); });
  if (!response.ok) {
    if (response.status === 401) throw new HttpError(401, "The domain service could not authenticate. Its access token needs to be updated.");
    if (response.status === 403) throw new HttpError(403, "The domain service does not have permission to manage this project. Check its access token permissions.");
    if (response.status === 404) throw new HttpError(404, "The domain was not found on the configured project.");
    if (response.status === 409 || response.status === 400) throw new HttpError(409, "This domain could not be connected. It may already belong to another project. No existing assignment was changed.");
    throw new HttpError(503, "The domain provider is unavailable. Check the configuration and try again.");
  }
  return response.json() as Promise<T>;
}
const project = () => encodeURIComponent(process.env.DOMAIN_VERCEL_PROJECT_ID!);

export type DomainServiceState = { ready: boolean; message: string };
/** Read-only check. Never return provider responses, credentials or project metadata to the browser. */
export async function domainServiceState(): Promise<DomainServiceState> {
  if (!domainsEnabled()) return { ready: false, message: "Domain connections are not enabled for this environment." };
  if (!domainConnectionReady()) return { ready: false, message: "Domain connections need service configuration before a domain can be added." };
  try {
    getDeployment();
    // Validate the branch before reserving a domain, too.
    domainBranch();
    const configured = await vercel<{ id?: string }>(`/v9/projects/${project()}`);
    if (configured.id !== process.env.DOMAIN_VERCEL_PROJECT_ID) return { ready: false, message: "The domain service returned an unexpected project. Check its configuration." };
    return { ready: true, message: "Enter a domain you already own, then follow its DNS instructions after connecting." };
  } catch (error) {
    return { ready: false, message: error instanceof HttpError && error.status === 404 ? "The configured project is not accessible to the domain service. Check its configuration."
      : error instanceof HttpError ? error.message
      : "The domain service could not be verified right now. Please reload to check again." };
  }
}

async function ownedDomain(id: unknown, storeId = STORE_ID) {
  if (!domainsEnabled()) throw new HttpError(404, "Domain connections are not enabled.");
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) throw new HttpError(404, "Domain not found.");
  const { data, error } = await getSupabase().from("store_domains").select("*").eq("store_id", storeId).eq("id", id).maybeSingle();
  if (error) throw new HttpError(503, "Could not load domain settings.");
  if (!data) throw new HttpError(404, "Domain not found.");
  return data;
}

export async function connectDomain(productId: unknown, input: unknown, storeId = STORE_ID) {
  if (!domainConnectionReady()) throw new HttpError(503, "Domain connections need to be configured for this environment.");
  const target = await domainTarget(productId, storeId);
  const hostname = assertDomainName(input);
  const branch = domainBranch();
  const service = await domainServiceState();
  if (!service.ready) throw new HttpError(503, service.message);
  // Reserve first: concurrent requests cannot attach one domain to two products.
  const { data, error } = await getSupabase().from("store_domains").insert({
    id: randomUUID(), store_id: storeId, product_id: target.id, hostname, status: "pending", verification: [], checked_at: null,
  }).select("*").single();
  if (error || !data) throw new HttpError(error?.code === "23505" ? 409 : 503, "This domain or store already has a connection. Remove the existing connection before adding another.");
  // On a provider timeout keep the pending reservation for reconciliation; never force/reassign.
  await vercel<ProjectDomain>(`/v10/projects/${project()}/domains`, "POST", { name: hostname, ...(branch ? { gitBranch: branch } : {}) });
  return checkDomain(data.id, storeId);
}

export async function checkDomain(id: unknown, storeId = STORE_ID) {
  const row = await ownedDomain(id, storeId);
  const branch = domainBranch();
  const path = `/v9/projects/${project()}/domains/${encodeURIComponent(row.hostname)}`;
  let assigned = await vercel<ProjectDomain>(path);
  // Never activate or remove a domain attached to another environment.
  if ((assigned.gitBranch ?? null) !== branch) throw new HttpError(409, "This domain belongs to another deployment environment.");
  if (!assigned.verified) {
    // A missing DNS challenge is an expected state. Re-read the challenges after attempting verification.
    try { await vercel(`${path}/verify`, "POST"); } catch (error) { if (!(error instanceof HttpError) || error.status !== 409) throw error; }
    assigned = await vercel<ProjectDomain>(path);
  }
  const config = await vercel<DomainConfig>(`/v6/domains/${encodeURIComponent(row.hostname)}/config?projectIdOrName=${project()}`);
  const records: DnsRecord[] = (assigned.verification ?? []).map((record) => ({ type: record.type, name: record.domain, value: record.value }));
  if (row.hostname === assigned.apexName) {
    const preferred = [...(config.recommendedIPv4 ?? [])].sort((a, b) => a.rank - b.rank)[0];
    for (const value of preferred?.value ?? []) records.push({ type: "A", name: row.hostname, value });
  } else {
    const preferred = [...(config.recommendedCNAME ?? [])].sort((a, b) => a.rank - b.rank)[0];
    if (preferred) records.push({ type: "CNAME", name: row.hostname, value: preferred.value });
  }
  let secure = false;
  if (assigned.verified && config.misconfigured === false) {
    const certificates = await vercel<{ certs: Certificate[] }>("/v8/certs");
    secure = certificates.certs.some((cert) => cert.expiresAt > Date.now() && cert.cns.some((name) => name === row.hostname ||
      (name.startsWith("*.") && row.hostname.split(".").slice(1).join(".") === name.slice(2))));
  }
  const update = { status: secure ? "active" as const : "pending" as const, verification: records, checked_at: new Date().toISOString() };
  const { data, error } = await getSupabase().from("store_domains").update(update).eq("store_id", storeId).eq("id", row.id).select("*").single();
  if (error || !data) throw new HttpError(503, "Could not save the domain status.");
  return data;
}

export async function removeDomain(id: unknown) {
  const row = await ownedDomain(id);
  const path = `/v9/projects/${project()}/domains/${encodeURIComponent(row.hostname)}`;
  // Disable routing before contacting the provider. A failed removal stays visibly pending.
  const disabled = await getSupabase().from("store_domains").update({ status: "pending" }).eq("store_id", STORE_ID).eq("id", row.id);
  if (disabled.error) throw new HttpError(503, "Could not disable the domain.");
  try {
    const assigned = await vercel<ProjectDomain>(path);
    if ((assigned.gitBranch ?? null) !== domainBranch()) throw new HttpError(409, "This domain belongs to another deployment environment.");
    await vercel(path, "DELETE");
  } catch (error) { if (!(error instanceof HttpError) || error.status !== 404) throw error; }
  const { error } = await getSupabase().from("store_domains").delete().eq("store_id", STORE_ID).eq("id", row.id);
  if (error) throw new HttpError(503, "Could not remove the domain record. Check status and try again.");
}

/** A provider failure or malformed response is unknown, never evidence of an unavailable domain. */
async function registrar(path: string, body?: object): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`https://api.vercel.com/v1/registrar/domains/${path}`, {
      method: body ? "POST" : "GET", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      cache: "no-store", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function numericPrice(value: unknown): value is number {
  // Some API price strings describe errors or unsupported names; never coerce them to quotes.
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function validTerm(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/** Read-only Registrar API; no purchase endpoint or billing credential is used by this flow. */
export async function searchDomain(input: unknown): Promise<DomainQuote[]> {
  getDeployment();
  if (!domainPurchasePreview()) throw new HttpError(404, "Domain search and purchase preview are not enabled.");
  const domain = assertDomainName(input);
  const data = await registrar("search", { domains: [domain] });
  const result = Array.isArray(data?.results) ? data.results.find((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object" && item.domain === domain) : undefined;
  const knownAvailable = result?.available === true;
  const premium = typeof result?.premium === "boolean" ? { premium: result.premium } : {};
  if (knownAvailable && validTerm(result.years) && numericPrice(result.price) && numericPrice(result.renewalPrice)) {
    return [{ domain, available: true, years: result.years, price: result.price, renewalPrice: result.renewalPrice, ...premium }];
  }
  // Combined search returns false for both unavailable domains AND failed availability/price checks.
  // Ask the explicit endpoint before declaring a name unavailable (reproduced on staging for .store).
  const exact = encodeURIComponent(domain);
  if (!knownAvailable) {
    const availability = await registrar(`${exact}/availability`);
    if (availability?.available !== true) return [{ domain, available: availability?.available === false ? false : null }];
  }
  const price = await registrar(`${exact}/price`);
  if (!price || !validTerm(price.years) || !numericPrice(price.purchasePrice) || !numericPrice(price.renewalPrice)) {
    return [{ domain, available: true, ...premium }];
  }
  return [{ domain, available: true, years: price.years, price: price.purchasePrice, renewalPrice: price.renewalPrice, ...premium }];
}

export async function rehearsePurchase(input: unknown, expectedPrice: unknown) {
  const [quote] = await searchDomain(input);
  if (!quote?.available || !validTerm(quote.years) || !numericPrice(quote.price) || !numericPrice(quote.renewalPrice)) throw new HttpError(409, "This domain cannot be quoted right now. Search again.");
  if (typeof expectedPrice !== "number" || quote.price !== expectedPrice) throw new HttpError(409, "The registration price changed. Search again to review the latest price.");
  return { simulated: true, registered: false, charged: false, quote };
}
