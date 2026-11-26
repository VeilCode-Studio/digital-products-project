export type DnsRecord = { type: string; name: string; value: string };
export type StoreDomain = {
  id: string; store_id: string; product_id: string; hostname: string;
  status: "pending" | "active"; verification: DnsRecord[];
  checked_at: string | null; created_at: string;
};
export type DomainQuote = {
  domain: string; available: boolean; years?: number; price?: number;
  renewalPrice?: number; premium?: boolean;
};
