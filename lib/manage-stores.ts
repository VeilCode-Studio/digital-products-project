import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { getCatalogProduct } from "./catalog";
import { mediaPrefix, parseStorePage, starterStorePage, storePageReadiness, StorePageError, type StorePage } from "./store-page";
import { BrandError, parseBrand, THEMES, type Brand, type ThemeId } from "./store-themes";
import { PoliciesError, storeReadinessProblems } from "./store-policies";
import {
  isUuid, MAX_PROFILES_PER_SAVE, MAX_SLUG, parseShippingProfile, parseVariants, policiesForSave, SLUG_PATTERN,
  storeImagePath, StoreInputError, type ProfileInput, type RateInput, type VariantInput,
} from "./store-input";
import { findPoster, formatBytes, isGeneratedPoster, mediaExtension, mediaKind, mediaUploadProblem, posterPathFor, sniffMedia, STORE_MEDIA_TYPES, type StoreMediaExtension, type StoreMediaFile } from "./store-media";
import { storefrontMediaBase } from "./storefront";
import { pixelsWithServerEvents } from "./tiktok";
import { metaPixelsWithServerEvents } from "./meta";
import { paymentContext } from "./payment-connections";
import type { CatalogProduct, ProductVariant, ShippingProfile, ShippingRate, StorePreviewDraft } from "./catalog.types";

// The admin editor for physical single-product stores. Every value is validated here before it is
// written; a save goes through one database transaction (save_physical_store), so the product and
// its variants never disagree.

const BUCKET = "storefront";
/** Store product ids are UUIDs (older demo stores use readable ids). */
const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

export type StoreEditorProfile = ProfileInput & { usedBy: { id: string; name: string }[] };
export type StoreEditorData = {
  product: {
    id: string; slug: string; name: string; tagline: string; status: "draft" | "published"; revision: number;
    theme: ThemeId; brand: Brand; page: StorePage; policies: Record<string, unknown>; shippingProfileId: string | null;
  };
  /** Set when the saved page could not be read; the editor shows it and saving replaces the page. */
  pageProblem: string | null;
  variants: VariantInput[];
  profiles: StoreEditorProfile[];
  media: StoreMediaFile[];
  mediaBase: string;
  /** TikTok pixels with a server access token configured, so purchases are also sent from the server. */
  tiktokServerPixels: string[];
  /** The same for Meta pixels (Conversions API). */
  metaServerPixels: string[];
};

const conflict = () => new HttpError(409, "This store was changed in another tab or window. Reload to get the latest version, then make your change again.");

async function loadPhysical(id: unknown, storeId: string) {
  if (typeof id !== "string" || !PRODUCT_ID.test(id)) throw new HttpError(404, "This store doesn't exist.");
  const product = await getCatalogProduct(id, storeId) as CatalogProduct | null;
  if (!product || product.kind !== "physical") throw new HttpError(404, "This store doesn't exist.");
  return product;
}

function mediaFolder(productId: string, storeId: string) { return `${mediaPrefix(storeId, productId)}media/`; }
function validMediaPath(path: unknown, folder: string): path is string {
  return typeof path === "string" && path.length <= 300 && path.startsWith(folder) && /^[A-Za-z0-9/_.-]+$/.test(path) &&
    !path.includes("..") && !path.slice(folder.length).includes("/") && mediaExtension(path) !== null;
}

export async function listStoreMedia(productId: string, storeId = STORE_ID): Promise<StoreMediaFile[]> {
  const folder = mediaFolder(productId, storeId);
  const { data, error } = await getSupabase().storage.from(BUCKET).list(folder.slice(0, -1), { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
  if (error) throw new Error("Could not list store media");
  const files = (data ?? []).filter((file) => file.id && mediaExtension(file.name));
  const paths = new Set(files.map((file) => folder + file.name));
  return files.filter((file) => !isGeneratedPoster(file.name)).map((file) => {
    const path = folder + file.name;
    const kind = STORE_MEDIA_TYPES[mediaExtension(file.name)!].kind;
    return { path, kind, size: Number(file.metadata?.size ?? 0), createdAt: file.created_at ?? "", poster: kind === "video" ? findPoster(path, paths) : null };
  });
}

export async function loadStoreEditor(id: string, storeId = STORE_ID): Promise<StoreEditorData> {
  const product = await loadPhysical(id, storeId);
  const db = getSupabase();
  const [variants, profiles, rates, products, media] = await Promise.all([
    db.from("product_variants").select("*").eq("store_id", storeId).eq("product_id", product.id).order("position"),
    db.from("shipping_profiles").select("*").eq("store_id", storeId).order("created_at"),
    db.from("shipping_rates").select("*").eq("store_id", storeId).order("position"),
    db.from("products").select("id, name, shipping_profile_id").eq("store_id", storeId).eq("kind", "physical"),
    listStoreMedia(product.id, storeId),
  ]);
  if (variants.error || profiles.error || rates.error || products.error) throw new Error("Could not load the store editor");

  let page: StorePage;
  let pageProblem: string | null = null;
  try { page = parseStorePage(product.page, storeId, product.id); } catch (error) {
    const raw = product.page as Partial<StorePage> | null;
    page = raw && Array.isArray(raw.sections) ? { version: 1, sections: raw.sections } : starterStorePage();
    pageProblem = error instanceof StorePageError ? error.message : "The saved page could not be read.";
  }
  let brand: Brand;
  try { brand = parseBrand(product.brand, storeId, product.id); } catch { brand = { name: "", logoPath: null, accent: null, supportEmail: null, tiktokPixelId: null, metaPixelId: null }; }
  const users = (products.data ?? []) as Pick<CatalogProduct, "id" | "name" | "shipping_profile_id">[];
  const allRates = (rates.data ?? []) as ShippingRate[];

  return {
    product: {
      id: product.id, slug: product.slug, name: product.name, tagline: product.tagline, status: product.status, revision: product.revision,
      theme: (THEMES as readonly string[]).includes(product.theme ?? "") ? product.theme as ThemeId : "clean-minimal",
      brand, page, policies: product.policies ?? {}, shippingProfileId: product.shipping_profile_id,
    },
    pageProblem,
    variants: ((variants.data ?? []) as ProductVariant[]).map((variant) => ({
      id: variant.id, options: variant.options ?? {}, sku: variant.sku, price_amount: variant.price_amount, compare_at_amount: variant.compare_at_amount,
      image_path: variant.image_path, active: variant.active, supplier_url: variant.supplier_url, supplier_sku: variant.supplier_sku,
    })),
    profiles: ((profiles.data ?? []) as ShippingProfile[]).map((profile) => ({
      id: profile.id, name: profile.name,
      rates: allRates.filter((rate) => rate.profile_id === profile.id).map((rate): RateInput => ({
        id: rate.id, market: rate.market, name: rate.name, amount: rate.amount, currency: rate.currency, min_days: rate.min_days, max_days: rate.max_days, active: rate.active,
      })),
      usedBy: users.filter((user) => user.shipping_profile_id === profile.id && user.id !== product.id).map((user) => ({ id: user.id, name: user.name })),
    })),
    media,
    mediaBase: storefrontMediaBase(),
    tiktokServerPixels: storeId === STORE_ID ? pixelsWithServerEvents() : [],
    metaServerPixels: storeId === STORE_ID ? metaPixelsWithServerEvents() : [],
  };
}

function requiredText(value: unknown, max: number, label: string) {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001F\u007F]/g, " ").trim() : "";
  if (!text) throw new HttpError(400, `${label} is required.`);
  if (text.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
  return text;
}
function storeSlug(value: unknown) {
  const slug = typeof value === "string" ? value.trim() : "";
  if (!slug || slug.length > MAX_SLUG || !SLUG_PATTERN.test(slug)) {
    throw new HttpError(400, `The store URL can use lowercase letters, numbers and single hyphens, up to ${MAX_SLUG} characters.`);
  }
  return slug;
}

/** Creates a draft store from the starter page; the owner then completes it in the editor. */
export async function createStore(raw: Record<string, unknown>, storeId = STORE_ID) {
  const name = requiredText(raw.name, 120, "Product name");
  const slug = storeSlug(raw.slug);
  const theme = (THEMES as readonly string[]).includes(raw.theme as string) ? raw.theme as ThemeId : "clean-minimal";
  const id = randomUUID();
  const { error } = await getSupabase().from("products").insert({
    id, store_id: storeId, slug, name, kind: "physical", status: "draft", currency: "usd", theme,
    brand: { name: name.slice(0, 40).trim() }, page: starterStorePage(), policies: {},
  });
  if (error) {
    throw error.code === "23505" ? new HttpError(409, "That store URL is already in use. Choose another.") : new HttpError(500, "Could not create the store. Please try again.");
  }
  return { id };
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Copies a store into a new draft to test another product or angle: page, brand, policies, shipping
 * profile and variants, with every media file copied into the new store's own folder.
 */
export async function duplicateStore(raw: Record<string, unknown>, storeId = STORE_ID) {
  const source = await loadPhysical(raw.id, storeId);
  const db = getSupabase();
  const id = randomUUID();
  const from = mediaPrefix(storeId, source.id);
  const to = mediaPrefix(storeId, id);

  const { data: variants, error: variantError } = await db.from("product_variants").select("*").eq("store_id", storeId).eq("product_id", source.id).order("position");
  if (variantError) throw new Error("Could not load variants");

  // Every file in the media library, plus anything the store uses outside it (a logo).
  const storage = db.storage.from(BUCKET);
  const { data: listed, error: listError } = await storage.list(mediaFolder(source.id, storeId).slice(0, -1), { limit: 1000 });
  if (listError) throw new HttpError(503, "Could not read the store's media. Please try again.");
  const files = new Set(((listed ?? []) as { id: string | null; name: string }[]).filter((file) => file.id && mediaExtension(file.name)).map((file) => mediaFolder(source.id, storeId) + file.name));
  // The prefix is "<store uuid>/<product id>/": letters, digits, hyphens and slashes, none special in a pattern.
  const used = JSON.stringify([source.page, source.brand, variants]).match(new RegExp(`${from}[A-Za-z0-9/_.-]+`, "g")) ?? [];
  for (const path of used) if (!path.includes("..")) files.add(path);
  for (const path of files) {
    const { error } = await storage.copy(path, to + path.slice(from.length));
    // A file the store points at but that is already gone is skipped; anything else stops the copy.
    if (error && !/not.?found/i.test(error.message ?? "")) throw new HttpError(503, "Could not copy the store's media. Please try again.");
  }
  const moved = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null).split(from).join(to));

  const base = `${source.slug.slice(0, MAX_SLUG - 8)}-copy`;
  const { data: taken, error: slugError } = await db.from("products").select("slug").eq("store_id", storeId);
  if (slugError) throw new Error("Could not check store URLs");
  const slugs = new Set(((taken ?? []) as { slug: string }[]).map((row) => row.slug));
  let slug = base;
  for (let n = 2; slugs.has(slug); n++) slug = `${base}-${n}`;

  const { error } = await db.from("products").insert({
    id, store_id: storeId, slug, name: `${source.name.slice(0, 112)} (copy)`, tagline: source.tagline, kind: "physical", status: "draft",
    currency: source.currency, theme: source.theme, brand: moved(source.brand), page: moved(source.page), policies: source.policies ?? {},
    shipping_profile_id: source.shipping_profile_id,
  });
  if (error) throw error.code === "23505" ? new HttpError(409, "That store URL is already in use. Please try again.") : new HttpError(500, "Could not copy the store. Please try again.");
  const copies = ((variants ?? []) as ProductVariant[]).map((variant) => ({
    id: randomUUID(), store_id: storeId, product_id: id, position: variant.position, options: variant.options, sku: variant.sku,
    price_amount: variant.price_amount, compare_at_amount: variant.compare_at_amount, image_path: moved(variant.image_path), active: variant.active,
    supplier_url: variant.supplier_url, supplier_sku: variant.supplier_sku,
  }));
  if (copies.length) {
    const { error: copyError } = await db.from("product_variants").insert(copies as never);
    if (copyError) {
      await db.from("products").delete().eq("store_id", storeId).eq("id", id);
      throw new HttpError(500, "Could not copy the store's variants. Please try again.");
    }
  }
  return { id, slug };
}

export async function saveStore(raw: Record<string, unknown>, storeId = STORE_ID) {
  const product = await loadPhysical(raw.id, storeId);
  const revision = raw.revision;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) throw new HttpError(400, "Reload the editor and try again.");
  if (product.revision !== revision) throw conflict();
  const status = raw.status === "published" ? "published" : raw.status === "draft" ? "draft" : null;
  if (!status) throw new HttpError(400, "Choose draft or published.");
  const publishing = status === "published";

  const name = requiredText(raw.name, 120, "Product name");
  const slug = storeSlug(raw.slug);
  const tagline = typeof raw.tagline === "string" ? raw.tagline.replace(/[\u0000-\u001F\u007F]/g, " ").trim() : "";
  if (tagline.length > 200) throw new HttpError(400, "The tagline must be 200 characters or fewer.");
  if (!(THEMES as readonly string[]).includes(raw.theme as string)) throw new HttpError(400, "Choose a theme.");
  const theme = raw.theme as ThemeId;

  let brand: Brand, page: StorePage, variants: VariantInput[], profiles: ProfileInput[], policies: Record<string, unknown>;
  try {
    brand = parseBrand(raw.brand, storeId, product.id);
    brand.logoPath = storeImagePath(brand.logoPath, storeId, product.id, "Logo");
    page = parseStorePage(raw.page, storeId, product.id);
    variants = parseVariants(raw.variants, storeId, product.id);
    const submitted = raw.profiles ?? [];
    if (!Array.isArray(submitted) || submitted.length > MAX_PROFILES_PER_SAVE) throw new StoreInputError("Too many shipping profiles in one save.");
    profiles = submitted.map(parseShippingProfile);
    policies = policiesForSave(raw.policies, product.policies, today(), publishing);
    // Adding or removing a pixel changes what the privacy policy says, so it changes its date too.
    const previous = product.brand as { tiktokPixelId?: unknown; metaPixelId?: unknown };
    const pixelsChanged = brand.tiktokPixelId !== (previous.tiktokPixelId ?? null) || brand.metaPixelId !== (previous.metaPixelId ?? null);
    if (pixelsChanged && "version" in policies) policies = { ...policies, updatedAt: today() };
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StorePageError || error instanceof BrandError) throw new HttpError(400, error.message);
    if (error instanceof PoliciesError) throw new HttpError(400, `Policies: ${error.message}`);
    throw error;
  }

  const db = getSupabase();
  const shippingProfileId = raw.shippingProfileId === null || raw.shippingProfileId === undefined ? null
    : isUuid(raw.shippingProfileId) ? raw.shippingProfileId.toLowerCase() : null;
  if (raw.shippingProfileId && !shippingProfileId) throw new HttpError(400, "Choose a shipping profile.");
  const { data: existing, error: profileError } = await db.from("shipping_profiles").select("id").eq("store_id", storeId);
  if (profileError) throw new Error("Could not load shipping profiles");
  const known = new Set([...((existing ?? []) as { id: string }[]).map((profile) => profile.id), ...profiles.map((profile) => profile.id)]);
  if (shippingProfileId && !known.has(shippingProfileId)) throw new HttpError(400, "Choose a shipping profile.");

  if (publishing) {
    const chosen = profiles.find((profile) => profile.id === shippingProfileId);
    let usRates = chosen ? chosen.rates.filter((rate) => rate.market === "US" && rate.active).length : 0;
    if (!chosen && shippingProfileId) {
      const { data, error } = await db.from("shipping_rates").select("id").eq("store_id", storeId).eq("profile_id", shippingProfileId).eq("market", "US").eq("active", true);
      if (error) throw new Error("Could not load shipping rates");
      usRates = (data ?? []).length;
    }
    const problems = storeReadinessProblems({
      pageProblems: storePageReadiness(page), activeVariants: variants.filter((variant) => variant.active).length,
      usRates, supportEmail: brand.supportEmail, policies,
    });
    if (problems.length) throw new HttpError(400, `Before publishing: ${problems.join(" ")}`);
    if (storeId !== STORE_ID) await paymentContext(storeId);
  }

  for (const profile of profiles) {
    const { error } = await db.rpc("save_shipping_profile", { p_store_id: storeId, p_profile_id: profile.id, p_name: profile.name, p_rates: profile.rates });
    if (error) {
      throw error.code === "42501" ? new HttpError(409, "A shipping profile was changed elsewhere. Reload the editor.") : new HttpError(500, "Could not save shipping. Your changes are still in the editor; please try again.");
    }
  }

  const { data, error } = await db.rpc("save_physical_store", {
    p_store_id: storeId, p_product_id: product.id, p_revision: revision,
    p_product: { name, slug, tagline, status, theme, brand, page, policies, shipping_profile_id: shippingProfileId },
    p_variants: variants,
  });
  if (error) {
    if (error.code === "PT409") throw conflict();
    if (error.code === "23505") throw new HttpError(409, "That store URL is already in use. Choose another.");
    if (error.code === "23514") throw new HttpError(400, "The store isn't complete enough to publish yet. Check the Publish tab.");
    if (error.code === "42501") throw new HttpError(409, "A variant was changed elsewhere. Reload the editor.");
    throw new HttpError(500, "Could not save the store. Your changes are still in the editor; please try again.");
  }
  return { revision: data as number, slug, status, policies };
}

/**
 * Keeps the editor's unsaved draft for the owner's live preview (/s/<slug>?preview=1&draft=1). It is
 * validated exactly like a save, but only the preview reads it: the saved store, checkout and visitors
 * are untouched.
 */
export async function saveStorePreview(raw: Record<string, unknown>, storeId = STORE_ID) {
  const product = await loadPhysical(raw.id, storeId);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 120) : product.name;
  const tagline = typeof raw.tagline === "string" ? raw.tagline.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 200) : "";
  const theme = (THEMES as readonly string[]).includes(raw.theme as string) ? raw.theme as ThemeId : (product.theme as ThemeId);
  let preview: StorePreviewDraft;
  try {
    const brand = parseBrand(raw.brand, storeId, product.id);
    brand.logoPath = storeImagePath(brand.logoPath, storeId, product.id, "Logo");
    const page = parseStorePage(raw.page, storeId, product.id);
    const variants = parseVariants(raw.variants, storeId, product.id).filter((variant) => variant.active);
    preview = {
      name, tagline, theme, brand, page,
      variants: variants.map((variant) => ({ id: variant.id, options: variant.options, price_amount: variant.price_amount, compare_at_amount: variant.compare_at_amount, image_path: variant.image_path })),
    };
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StorePageError || error instanceof BrandError) throw new HttpError(400, error.message);
    throw error;
  }
  const { error } = await getSupabase().from("products").update({ preview_draft: preview, preview_updated_at: new Date().toISOString() })
    .eq("store_id", storeId).eq("id", product.id);
  if (error) throw new HttpError(503, "Could not update the preview.");
  return { ok: true };
}

// ── Media ─────────────────────────────────────────────────────────────────────────────────────

/** A signed URL for one new file in this store's media folder; the browser uploads it directly. */
export async function prepareStoreMedia(raw: Record<string, unknown>, storeId = STORE_ID) {
  const product = await loadPhysical(raw.productId, storeId);
  const filename = typeof raw.filename === "string" ? raw.filename.slice(0, 255) : "";
  const size = typeof raw.size === "number" && Number.isSafeInteger(raw.size) ? raw.size : 0;
  const problem = mediaUploadProblem(filename, size);
  if (problem) throw new HttpError(400, problem);
  const extension = mediaExtension(filename)!;
  const folder = mediaFolder(product.id, storeId);
  let path = `${folder}${randomUUID()}.${extension}`;
  const poster = raw.posterFor !== undefined && raw.posterFor !== null;
  if (poster) {
    if (!validMediaPath(raw.posterFor, folder) || mediaKind(raw.posterFor) !== "video" || !["webp", "jpg", "png"].includes(extension)) {
      throw new HttpError(400, "Invalid video poster.");
    }
    path = posterPathFor(raw.posterFor, extension as "webp" | "jpg" | "png");
  }
  const { data, error } = await getSupabase().storage.from(BUCKET).createSignedUploadUrl(path, { upsert: poster });
  if (error || !data) throw new HttpError(503, "Could not prepare the upload. Please try again.");
  return { signedUrl: data.signedUrl, path, contentType: STORE_MEDIA_TYPES[extension].contentType };
}

async function firstBytes(url: string, count = 64) {
  const response = await fetch(url, { headers: { Range: `bytes=0-${count - 1}` }, cache: "no-store" });
  if (!response.ok || !response.body) throw new HttpError(503, "Could not check the uploaded file. Please try again.");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(count);
  let length = 0;
  while (length < count) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value.subarray(0, count - length);
    bytes.set(part, length);
    length += part.length;
  }
  await reader.cancel().catch(() => {});
  return bytes.subarray(0, length);
}

/** Verifies an upload arrived intact and is the type its name says; removes it if not. */
export async function confirmStoreMedia(raw: Record<string, unknown>, storeId = STORE_ID): Promise<StoreMediaFile> {
  const product = await loadPhysical(raw.productId, storeId);
  const path = raw.path;
  if (!validMediaPath(path, mediaFolder(product.id, storeId))) throw new HttpError(400, "Invalid media file.");
  const extension = mediaExtension(path)!;
  const type = STORE_MEDIA_TYPES[extension];
  const storage = getSupabase().storage.from(BUCKET);
  const { data: info, error } = await storage.info(path);
  if (error || !info) throw new HttpError(400, "The upload didn't arrive. Please try again.");
  const size = Number(info.size);
  const reject = async (message: string) => { await storage.remove([path]); return new HttpError(400, message); };
  if (!size || size > type.maxBytes || info.contentType !== type.contentType) throw await reject("The upload didn't match the file you chose. Please try again.");
  if (!sniffMedia(await firstBytes(storefrontMediaBase() + path), extension)) {
    throw await reject(`That file isn't a real ${extension.toUpperCase()} ${type.kind}. Export it again and retry.`);
  }
  return { path, kind: type.kind, size, createdAt: new Date().toISOString(), poster: null };
}

/** Detects a store media type from a file's first bytes, so a mislabelled download can't sneak in. */
export function detectStoreMedia(bytes: Uint8Array): StoreMediaExtension | null {
  return (Object.keys(STORE_MEDIA_TYPES) as StoreMediaExtension[]).find((extension) => sniffMedia(bytes, extension)) ?? null;
}

/**
 * Saves a file an assistant sent (lib/mcp) into a store's media folder, after the same type and size
 * checks the editor's uploads get. Returns the path to use in the page or variants.
 */
export async function importStoreMediaBytes(productId: string, bytes: Uint8Array, storeId = STORE_ID): Promise<StoreMediaFile & { url: string }> {
  const product = await loadPhysical(productId, storeId);
  const extension = detectStoreMedia(bytes.subarray(0, 64));
  if (!extension) throw new HttpError(400, "That file isn't a PNG, JPG, WebP, AVIF or GIF image, or an MP4 or WebM video.");
  const type = STORE_MEDIA_TYPES[extension];
  if (!bytes.length || bytes.length > type.maxBytes) throw new HttpError(400, `That ${type.kind} is too large. The limit is ${formatBytes(type.maxBytes)}.`);
  const path = `${mediaFolder(product.id, storeId)}${randomUUID()}.${extension}`;
  const { error } = await getSupabase().storage.from(BUCKET).upload(path, bytes, { contentType: type.contentType, upsert: false });
  if (error) throw new HttpError(503, "Could not save the file. Please try again.");
  return { path, kind: type.kind, size: bytes.length, createdAt: new Date().toISOString(), poster: null, url: storefrontMediaBase() + path };
}

/** Deletes an unused file (and a video's generated poster). Files used by the saved store are kept. */
export async function deleteStoreMedia(raw: Record<string, unknown>, storeId = STORE_ID) {
  const product = await loadPhysical(raw.productId, storeId);
  const path = raw.path;
  if (!validMediaPath(path, mediaFolder(product.id, storeId))) throw new HttpError(400, "Invalid media file.");
  const { data: variants, error } = await getSupabase().from("product_variants").select("image_path").eq("store_id", storeId).eq("product_id", product.id);
  if (error) throw new Error("Could not load variants");
  const used = JSON.stringify([product.page, product.brand]).includes(JSON.stringify(path)) ||
    ((variants ?? []) as Pick<ProductVariant, "image_path">[]).some((variant) => variant.image_path === path);
  if (used) throw new HttpError(409, "This file is used by the saved store. Remove it from the page or variants and save first.");
  const targets = mediaKind(path) === "video" ? [path, ...(["webp", "jpg", "png"] as const).map((extension) => posterPathFor(path, extension))] : [path];
  const { error: removeError } = await getSupabase().storage.from(BUCKET).remove(targets);
  if (removeError) throw new HttpError(503, "Could not delete the file. Please try again.");
  return { ok: true };
}
