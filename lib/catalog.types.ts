import type { Currency } from "./store-config";

export type ProductKind = "digital" | "physical";
export type Market = "US" | "GB";

export type DeliveryProduct = {
  name: string; shortName: string; emailSubject: string;
  storagePath: string; downloadFilename: string; templatesUrl: string | null;
};
export type Store = {
  id: string; owner_user_id: string | null; name: string; tagline: string;
  bio: string; support_email: string; website_url: string | null;
  enabled_markets?: Market[];
};
export type CatalogProduct = {
  id: string; store_id: string; slug: string; name: string; tagline: string;
  description: string; includes: string[]; status: "draft" | "published";
  stripe_product_id: string | null; stripe_price_id: string | null;
  price_amount: number | null; currency: Currency; stripe_livemode: boolean | null;
  storage_path: string | null; download_filename: string | null;
  templates_url: string | null; cover_path: string | null; cover_type: string | null;
  sort_order: number; revision: number; created_at: string; updated_at: string;
  // Physical single-product stores. Digital products keep the defaults.
  kind: ProductKind; theme: string | null; brand: Record<string, unknown>;
  page: Record<string, unknown> | null; shipping_profile_id: string | null;
  /** Policy settings for physical stores; see lib/store-policies.ts. */
  policies?: Record<string, unknown>;
  /** Digital products suggested under this one's page, in order (lib/related-products.ts). */
  related_ids?: string[];
  /** The store editor's unsaved draft, shown only in the owner's live preview (lib/manage-stores.ts). */
  preview_draft?: StorePreviewDraft | null; preview_updated_at?: string | null;
};
export type StorePreviewDraft = {
  name: string; tagline: string; theme: string; brand: Record<string, unknown>; page: Record<string, unknown>;
  variants: { id: string; options: Record<string, string>; price_amount: number; compare_at_amount: number | null; image_path: string | null }[];
};
export type ProductVariant = {
  id: string; store_id: string; product_id: string; position: number;
  options: Record<string, string>; sku: string | null;
  price_amount: number; compare_at_amount: number | null; image_path: string | null; active: boolean;
  supplier_url: string | null; supplier_sku: string | null; created_at: string; updated_at: string;
};
export type ShippingProfile = { id: string; store_id: string; name: string; created_at: string };
export type ShippingRate = {
  id: string; store_id: string; profile_id: string; market: Market; name: string;
  amount: number; currency: "usd" | "gbp"; min_days: number; max_days: number;
  position: number; active: boolean; created_at: string;
};

/** What a physical checkout charged and promised, frozen at reservation time. */
export type PhysicalSnapshot = {
  brand: { name: string; supportEmail: string | null };
  currency: string;
  items: {
    productId: string; variantId: string; name: string; variantLabel: string; sku: string | null;
    unitAmount: number; quantity: number; imagePath: string | null;
    supplierUrl: string | null; supplierSku: string | null;
    /** Set when a bundle offer applied: the price before the discount, and the discount on each unit. */
    listUnitAmount?: number; percentOff?: number;
  }[];
  shippingOptions: { rateId: string; name: string; amount: number; minDays: number; maxDays: number }[];
  /** Business days to prepare the order before it ships, as the store's policies promised at checkout. */
  processingDays?: { min: number; max: number };
  /** Set on the order from the option the buyer chose in Stripe Checkout. */
  shipping?: { name: string; amount: number; minDays: number; maxDays: number } | null;
};
export type ShippingAddress = {
  name: string | null; line1: string | null; line2: string | null; city: string | null;
  state: string | null; postal_code: string | null; country: string | null; phone: string | null;
};

/** What a checkout request knew about the shopper for ad attribution (lib/tiktok.ts). */
/** Ad click and browser ids from checkout: TikTok's (ttclid, _ttp) and Meta's (_fbc, _fbp), plus the request details both match on. */
export type AdAttribution = { ttclid: string | null; ttp: string | null; ip: string | null; userAgent: string | null; url: string | null; fbc?: string | null; fbp?: string | null };

export type Checkout = {
  id: string; store_id: string; product_id: string; stripe_session_id: string | null;
  stripe_price_id: string | null; amount: number; currency: string;
  product_slug: string;
  product_snapshot: DeliveryProduct | null; created_at: string;
  payment_connection_id?: string | null; checkout_origin?: string | null;
  kind?: ProductKind; variant_id?: string | null; quantity?: number;
  physical_snapshot?: PhysicalSnapshot | null;
  attribution?: AdAttribution | null;
  /** Abandoned checkout recovery (lib/abandoned.ts). */
  expired_at?: string | null; recovery_url?: string | null; recovery_email?: string | null; recovered_at?: string | null;
  /** The short link the shopper arrived through (lib/short-links.ts). */
  link_slug?: string | null;
};
