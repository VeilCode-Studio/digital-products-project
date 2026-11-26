import { domainToASCII } from "node:url";

/** Accept hostnames only: never paths, credentials, IPs, ports or local names. */
export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 253) return null;
  const raw = input.trim().toLowerCase().replace(/\.$/, "");
  if (/[\s/:@?#\\%]/.test(raw)) return null;
  const host = domainToASCII(raw);
  if (!host || host.length > 253 || !host.includes(".")) return null;
  const labels = host.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels.at(-1)!)) return null;
  if (["localhost", "local", "internal", "test", "invalid", "example", "vercel.app"].some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null;
  return host;
}

/** Purchasing has no production override. Real registration is deliberately absent from this release. */
export function domainPurchasePreview(vars: Record<string, string | undefined> = process.env) {
  return vars.DOMAIN_PURCHASE_PREVIEW === "true" &&
    ["development", "preview"].includes(vars.DEPLOYMENT_ENV ?? "") &&
    vars.VERCEL_ENV !== "production" && vars.VERCEL_TARGET_ENV !== "production";
}

export function storefrontPath(product: { kind?: string; slug: string }) {
  return `/${product.kind === "physical" ? "s" : "p"}/${encodeURIComponent(product.slug)}`;
}

/** Public paths allowed on a product domain; management and other products stay on the platform. */
export function domainPath(path: string, product: { kind?: string; slug: string }): string | null {
  const base = storefrontPath(product);
  if (path === "/") return base;
  if (path === base || path.startsWith(`${base}/`)) return path;
  if (product.kind === "physical" && (/^\/policies\/(privacy|terms|shipping|returns|contact)$/.test(path) || ["/thank-you", "/cancel"].includes(path))) return base + path;
  if (product.kind !== "physical" && ["/thank-you", "/privacy", "/terms", "/refunds", "/support", "/data-deletion"].includes(path)) return path;
  if (["/api/checkout", "/api/checkout/physical", "/api/subscribe"].includes(path)) return path;
  if (path.startsWith(`/api/products/`)) return path;
  return null;
}
