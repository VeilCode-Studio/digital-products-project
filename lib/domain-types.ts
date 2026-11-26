export type DnsRecord = { type: string; name: string; value: string };
export type StoreDomain = {
  id: string; store_id: string; product_id: string; hostname: string;
  status: "pending" | "active"; verification: DnsRecord[];
  checked_at: string | null; created_at: string;
};
export type DomainQuote = {
  /** null means the provider could not verify availability, not that the name is taken. */
  domain: string; available: boolean | null; years?: number; price?: number;
  renewalPrice?: number; premium?: boolean;
};

export type DomainTestPayment = {
  id: string; domain: string; amount: number; currency: string;
  status: "pending" | "processing" | "failed" | "paid" | "expired";
  checkoutUrl: string | null; failure: string | null;
};
