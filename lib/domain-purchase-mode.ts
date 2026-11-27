import "server-only";
import { getDeployment, getEnv } from "./env";
import { HttpError } from "./http";
import type { DomainPurchaseContext } from "./domain-purchase-journal";

export function domainPurchaseMode(): "sandbox" | "live" | null {
  const deployment = getDeployment();
  const key = getEnv().STRIPE_SECRET_KEY;
  if (process.env.DOMAIN_PURCHASE_MODE === "sandbox" && !deployment.production &&
      process.env.VERCEL_ENV !== "production" && process.env.VERCEL_TARGET_ENV !== "production" && /^(sk|rk)_test_/.test(key)) return "sandbox";
  if (process.env.DOMAIN_PURCHASE_MODE === "live" && deployment.production && /^(sk|rk)_live_/.test(key)) return "live";
  return null;
}
export function domainPurchaseContext(ownerId: string, storeId: string): DomainPurchaseContext {
  const mode = domainPurchaseMode();
  if (!mode) throw new HttpError(503, "Domain purchasing is not enabled for this environment.");
  return { ownerId, storeId, origin: new URL(getEnv().APP_URL).origin, livemode: mode === "live" };
}
