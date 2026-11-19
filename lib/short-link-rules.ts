// Slug rules for short links, shared by the server (lib/short-links.ts) and the Links page.
export const LINK_SOURCES = ["tiktok", "instagram", "youtube", "facebook", "other"] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Top-level paths the app already uses, plus a few that could be confused for them. */
const RESERVED = new Set(["admin", "api", "s", "p", "oauth", "privacy", "terms", "refunds", "thank-you", "download-error", "data-deletion",
  "login", "logout", "account", "checkout", "cart", "shop", "store", "stores", "help", "support", "contact", "about", "static", "assets", "public", "brand", "home", "index", "robots", "sitemap", "favicon", "icon", "apple-icon"]);

/** Lowercases, turns spaces and punctuation into single hyphens, and trims to 32 characters. */
export function normalizeSlug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
}

/** Why a slug can't be used, or null when it can. */
export function slugProblem(slug: string) {
  if (slug.length < 2) return "Use at least 2 characters.";
  if (slug.length > 32) return "Keep it to 32 characters or fewer.";
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters and numbers, with single hyphens between words.";
  if (RESERVED.has(slug)) return "That word is already used by the site. Try another.";
  return null;
}

/** Short, typeable suggestions for a product: its first word, first two words, and the full slug. */
export function suggestSlugs(name: string, taken: Set<string> = new Set()) {
  const words = normalizeSlug(name).split("-").filter((word) => word.length > 1 && !["the", "a", "an", "and", "for", "of", "with", "to"].includes(word));
  const ideas = [words[0], words.slice(0, 2).join(""), words.slice(0, 2).join("-"), words.slice(0, 3).join("")].filter(Boolean) as string[];
  const unique = [...new Set(ideas.map((idea) => idea.slice(0, 32)))].filter((idea) => !slugProblem(idea) && !taken.has(idea));
  // When everything is taken, number the shortest idea: lamp2, lamp3...
  for (let n = 2; unique.length < 3 && ideas[0] && n < 50; n++) { const next = `${ideas[0].slice(0, 30)}${n}`; if (!taken.has(next) && !slugProblem(next)) unique.push(next); }
  return unique.slice(0, 3);
}
