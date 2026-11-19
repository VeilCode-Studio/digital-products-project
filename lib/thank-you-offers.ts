import "server-only";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { codeUsable, describeDiscount, type DiscountCode } from "./discount-codes";
import { relatedProducts } from "./related-products";
import type { CatalogProduct } from "./catalog.types";

// What a buyer sees after paying: a reason to come back (the code the owner picked for thank-you
// pages, while Stripe would still accept it) and, after a digital purchase, what pairs with it.
// Nothing here costs anything to deliver, so any second sale is almost pure margin.

export type ThankYouCode = { code: string; description: string; endsAt: string | null };
export type ThankYouOffers = { code: ThankYouCode | null; products: CatalogProduct[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function thankYouCode(): Promise<ThankYouCode | null> {
  const db = getSupabase();
  const { data: store } = await db.from("stores").select("thank_you_code_id").eq("id", STORE_ID).maybeSingle();
  const id = (store as { thank_you_code_id?: string | null } | null)?.thank_you_code_id;
  if (!id) return null;
  const { data } = await db.from("discount_codes").select("*").eq("id", id).eq("store_id", STORE_ID).maybeSingle();
  const code = data as DiscountCode | null;
  if (!code) return null;
  let used = 0;
  if (code.max_redemptions !== null) {
    const { data: orders } = await db.from("orders").select("id").eq("store_id", STORE_ID).eq("discount_code", code.code);
    used = (orders ?? []).length;
  }
  return codeUsable(code, used) ? { code: code.code, description: describeDiscount(code), endsAt: code.expires_at } : null;
}

export async function setThankYouCode(codeId: unknown) {
  const db = getSupabase();
  let id: string | null = null;
  if (typeof codeId === "string" && codeId) {
    const { data } = await db.from("discount_codes").select("id").eq("id", codeId).eq("store_id", STORE_ID).maybeSingle();
    if (!data) throw new HttpError(400, "Choose one of your codes.");
    id = codeId;
  }
  const { error } = await db.from("stores").update({ thank_you_code_id: id }).eq("id", STORE_ID);
  if (error) throw new HttpError(500, "Could not save the change.");
  return { thankYouCodeId: id };
}

/**
 * After a digital purchase: the bought product's chosen suggestions, topped up with the rest of the
 * collection (newest first), never the product just bought. `ref` is the checkout id in the success URL.
 */
export async function digitalOffers(ref: unknown): Promise<ThankYouOffers> {
  const code = await thankYouCode().catch(() => null);
  if (typeof ref !== "string" || !UUID.test(ref)) return { code, products: [] };
  const db = getSupabase();
  const { data: checkout } = await db.from("checkouts").select("product_id").eq("id", ref).eq("store_id", STORE_ID).maybeSingle();
  const boughtId = (checkout as { product_id?: string } | null)?.product_id;
  if (!boughtId) return { code, products: [] };
  const { data } = await db.from("products").select("*").eq("store_id", STORE_ID).eq("kind", "digital").eq("status", "published");
  const published = ((data ?? []) as CatalogProduct[]).filter((product) => product.price_amount !== null);
  const bought = published.find((product) => product.id === boughtId);
  const chosen = bought ? relatedProducts(bought, published) : [];
  const rest = published.filter((product) => product.id !== boughtId && !chosen.some((entry) => entry.id === product.id))
    .sort((a, b) => a.sort_order - b.sort_order || Date.parse(b.created_at) - Date.parse(a.created_at));
  return { code, products: [...chosen, ...rest].slice(0, 2) };
}
