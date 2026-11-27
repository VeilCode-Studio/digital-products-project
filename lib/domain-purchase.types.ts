export type DomainPurchaseStatus = "checkout_pending" | "paid" | "registering" | "registration_pending" | "registered"
  | "registration_failed" | "registration_unknown" | "refund_pending" | "refunded" | "refund_failed" | "expired";

/** Private, server-only journal row. Never serialize a whole row into a client component or API response. */
export type DomainPurchase = {
  id: string; store_id: string; owner_user_id: string; product_id: string; hostname: string;
  origin: string; livemode: boolean; amount: number; renewal_amount: number; currency: "usd";
  years: number; auto_renew: boolean; request_hash: string; contact: Record<string, unknown> | null;
  status: DomainPurchaseStatus; stripe_session_id: string | null; stripe_payment_intent_id: string | null;
  registrar_order_id: string | null; stripe_refund_id: string | null; failure_code: string | null;
  registered_at: string | null; created_at: string; updated_at: string;
  simulation_scenario: "success" | "failure" | "uncertain" | null;
  terms_version: string;
};
