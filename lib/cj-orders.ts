import "server-only";
import { getSupabase } from "./supabase";
import { HttpError } from "./http";
import { STORE_ID } from "./store-config";
import { getDeployment } from "./env";
import { applyFulfillment, parseFulfillmentAction } from "./fulfillment";
import { matchCjVariant } from "./margins";
import { cjBalance, cjConfigured, cjCreateOrder, cjOrderDetail, cjPidFromUrl, cjShippingQuotes, cjVariantPrices, type CjQuote } from "./cj";
import type { Order } from "./database.types";
import type { ProductVariant } from "./catalog.types";

// Ordering from CJ in one click, and following CJ orders until they're delivered.
//  - plan: what CJ would charge for an order (each item matched to its CJ variant, stock, shipping to
//    the buyer's ZIP) and the wallet balance. Nothing is placed.
//  - place: re-plans on the server, then places the order with the shipping method the owner chose.
//    Production pays from the CJ wallet; preview and development place unpaid CJ sandbox orders.
//    What CJ charged becomes the order's supplier cost (and the variants' cost, lib/margins.ts).
//  - sync: CJ orders that are ordered or shipped get their tracking and delivery from CJ, with the
//    usual tracking email.

/** Set on an order while its CJ order is being placed, so a second click or tab can't place it twice. */
export const CJ_PENDING = "CJ: placing…";
const PENDING_STALE_MS = 10 * 60_000;
/** A CJ order code ("SD2611…", "CJ…" plus digits): an order this sync can follow. */
const CJ_ORDER_REF = /^[A-Z]{0,4}\d{12,30}$/;

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

export type CjPlanLine = { variantId: string; name: string; label: string; quantity: number; vid: string | null; unitCost: number | null; stock: number | null; usStock: number | null };
export type CjPlan = {
  lines: CjPlanLine[]; from: "US" | "CN"; methods: CjQuote[]; suggested: string | null;
  /** The longest delivery the buyer was promised at checkout, in business days. */
  promisedDays: number | null; productTotal: number; balance: number | null; sandbox: boolean;
  /** Reasons this order can't be placed with CJ from here. Empty when it can. */
  problems: string[];
};

const sandboxMode = () => !getDeployment().production;

async function loadOrder(orderId: string) {
  const { data, error } = await getSupabase().from("orders").select("*").eq("id", orderId).eq("store_id", STORE_ID).eq("kind", "physical").maybeSingle();
  if (error) throw new Error("Could not load order");
  if (!data) throw new HttpError(404, "Order not found.");
  return data as Order;
}

/** The cheapest method that arrives within the promise, else the fastest one. */
export function suggestMethod(methods: CjQuote[], promisedDays: number | null) {
  if (!methods.length) return null;
  const fits = promisedDays ? methods.filter((method) => method.maxDays !== null && method.maxDays <= promisedDays) : methods;
  if (fits.length) return fits[0].name;
  return [...methods].sort((a, b) => (a.maxDays ?? 999) - (b.maxDays ?? 999) || a.cost - b.cost)[0].name;
}

/** What placing this order with CJ would involve. Places nothing. */
export async function planCjOrder(orderId: string): Promise<CjPlan> {
  if (!cjConfigured()) throw new HttpError(503, "Add CJ_API_KEY to this environment to order from CJ here.");
  const order = await loadOrder(orderId);
  const problems: string[] = [];
  if ((order.fulfillment_status ?? "needs_ordering") !== "needs_ordering") problems.push("This order isn't waiting to be ordered any more.");
  const pendingSince = order.supplier_order_ref === CJ_PENDING ? Date.parse(order.ordered_at ?? "") || 0 : null;
  if (pendingSince !== null && Date.now() - pendingSince < PENDING_STALE_MS) problems.push("A CJ order is being placed for this order right now.");
  else if (pendingSince !== null) problems.push("An earlier attempt to place this on CJ didn't finish. Check your CJ orders first; if it isn't there, mark this order as ordered by hand or try again.");
  const address = order.shipping_address;
  if (!address?.line1 || !address.city || !address.postal_code || !address.name) problems.push("The shipping address is incomplete.");
  else if ((address.country ?? "").toUpperCase() !== "US") problems.push("Ordering from CJ here supports US addresses only.");

  const items = order.physical_snapshot?.items ?? [];
  const { data: rows } = items.length
    ? await getSupabase().from("product_variants").select("*").eq("store_id", STORE_ID).in("id", items.map((item) => item.variantId))
    : { data: [] };
  const current = new Map(((rows ?? []) as ProductVariant[]).map((variant) => [variant.id, variant]));
  const lines: CjPlanLine[] = [];
  for (const item of items) {
    const variant = current.get(item.variantId);
    const supplierUrl = variant?.supplier_url ?? item.supplierUrl;
    const line: CjPlanLine = { variantId: item.variantId, name: item.name, label: item.variantLabel, quantity: item.quantity, vid: null, unitCost: null, stock: null, usStock: null };
    lines.push(line);
    const pid = cjPidFromUrl(supplierUrl);
    if (!pid) { problems.push(`${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} isn't linked to a CJ product.`); continue; }
    const prices = await cjVariantPrices(pid);
    if (!prices?.length) { problems.push(`CJ no longer lists ${item.name}.`); continue; }
    const match = matchCjVariant(prices, variant?.supplier_sku ?? item.supplierSku);
    if (!match) { problems.push(`Can't tell which CJ variant ${item.name}${item.variantLabel ? ` (${item.variantLabel})` : ""} is. Put CJ's variant SKU in its supplier SKU.`); continue; }
    Object.assign(line, { vid: match.vid, unitCost: match.cost, stock: match.stock ?? null, usStock: match.usStock ?? null });
    if (typeof match.stock === "number" && match.stock < item.quantity) problems.push(`CJ has ${match.stock} of ${item.name} in stock; this order needs ${item.quantity}.`);
  }

  const matched = lines.filter((line): line is CjPlanLine & { vid: string } => !!line.vid);
  // From the US warehouse only when it holds every item, so the order ships as one parcel.
  const from: "US" | "CN" = matched.length && matched.every((line) => (line.usStock ?? 0) >= line.quantity) ? "US" : "CN";
  let methods: CjQuote[] = [];
  if (matched.length && matched.length === lines.length) {
    methods = await cjShippingQuotes(from, address?.postal_code ?? null, matched.map((line) => ({ vid: line.vid, quantity: line.quantity }))).catch(() => []);
    if (!methods.length) problems.push("CJ can't quote shipping for this order right now.");
  }
  const sandbox = sandboxMode();
  const balance = sandbox ? null : await cjBalance().catch(() => null);
  const promisedDays = order.physical_snapshot?.shipping?.maxDays ?? null;
  return {
    lines, from, methods, suggested: suggestMethod(methods, promisedDays), promisedDays,
    productTotal: matched.reduce((sum, line) => sum + (line.unitCost ?? 0) * line.quantity, 0), balance, sandbox, problems,
  };
}

/** Places the order with CJ using the chosen shipping method, then marks it ordered with CJ's code and cost. */
export async function placeCjOrder(orderId: string, logisticName: unknown) {
  if (typeof logisticName !== "string" || !logisticName.trim()) throw new HttpError(400, "Choose a shipping method.");
  const plan = await planCjOrder(orderId);
  // A stale attempt is the owner's call: retrying is allowed once they've checked CJ.
  const blocking = plan.problems.filter((problem) => !problem.startsWith("An earlier attempt"));
  if (blocking.length) throw new HttpError(409, blocking[0]);
  const method = plan.methods.find((option) => option.name === logisticName.trim());
  if (!method) throw new HttpError(409, "That shipping method isn't available for this order any more. Get the CJ price again.");
  const estimate = plan.productTotal + method.cost;
  if (plan.balance !== null && plan.balance < estimate) {
    throw new HttpError(409, `Your CJ balance is $${(plan.balance / 100).toFixed(2)}; this order needs about $${(estimate / 100).toFixed(2)}. Top up your CJ wallet, then try again.`);
  }

  const order = await loadOrder(orderId);
  const db = getSupabase();
  // Claim the order: only one request may get past here.
  const claim = db.from("orders").update({ supplier_order_ref: CJ_PENDING, ordered_at: new Date().toISOString() })
    .eq("id", order.id).eq("store_id", STORE_ID).eq("fulfillment_status", "needs_ordering");
  const { data: claimed, error } = await (order.supplier_order_ref ? claim.eq("supplier_order_ref", order.supplier_order_ref) : claim.is("supplier_order_ref", null)).select("id").maybeSingle();
  if (error) throw new Error("Could not claim order");
  if (!claimed) throw new HttpError(409, "This order changed in another tab. Reload to see its latest status.");

  const address = order.shipping_address!;
  const state = (address.state ?? "").trim();
  let placed: Awaited<ReturnType<typeof cjCreateOrder>>;
  try {
    placed = await cjCreateOrder({
      orderNumber: order.id, logisticName: method.name, from: plan.from, sandbox: plan.sandbox,
      address: {
        name: address.name!, line1: address.line1!, line2: address.line2, city: address.city!, zip: address.postal_code!,
        state: US_STATES[state.toUpperCase()] ?? state, phone: address.phone,
      },
      products: plan.lines.map((line, index) => ({ vid: line.vid!, quantity: line.quantity, lineId: `${order.id.slice(0, 8)}-${index + 1}` })),
    });
  } catch (failure) {
    // No answer (504): CJ may have placed it, so the claim stays and the owner checks CJ before retrying.
    if (failure instanceof HttpError && failure.status === 504) {
      throw new HttpError(504, "CJ didn't answer in time, so the order may or may not have been placed. Check your CJ orders before trying again.");
    }
    // CJ said no: nothing was placed, so release the claim and let the owner retry.
    await db.from("orders").update({ supplier_order_ref: order.supplier_order_ref ?? null, ordered_at: order.ordered_at ?? null })
      .eq("id", order.id).eq("store_id", STORE_ID).eq("supplier_order_ref", CJ_PENDING);
    throw failure;
  }

  const cost = (placed.productAmount ?? plan.productTotal) + (placed.postageAmount ?? method.cost);
  const updated = await applyFulfillment(order.id, "needs_ordering", { action: "ordered", supplierRef: placed.orderId, supplierCost: cost });
  // CJ's create answer leaves the status blank, so read the order back to see whether it was paid.
  const status = plan.sandbox ? null : placed.status ?? (await cjOrderDetail(placed.orderId).catch(() => null))?.status ?? null;
  return {
    order: updated, cjOrderId: placed.orderId, cost, sandbox: plan.sandbox,
    message: plan.sandbox ? `Placed CJ sandbox order ${placed.orderId}. Sandbox orders are never paid or shipped.`
      : !status ? `Placed CJ order ${placed.orderId}. Check it shows as paid in your CJ orders.`
        : ["CREATED", "IN_CART", "UNPAID"].includes(status.toUpperCase()) ? `Placed CJ order ${placed.orderId}, but CJ hasn't taken payment yet. Pay it in your CJ orders.`
          : `Placed and paid CJ order ${placed.orderId}.`,
  };
}

/** Follows CJ orders: tracking moves an order to shipped (and emails the buyer), delivery to delivered. */
export async function syncCjOrders(limit = 30, budgetMs = 15_000, only?: string[]) {
  if (!cjConfigured()) return { checked: 0, shipped: 0, delivered: 0, skipped: "CJ_API_KEY not set" };
  const started = Date.now();
  const { data, error } = await getSupabase().from("orders").select("*")
    .eq("store_id", STORE_ID).eq("kind", "physical").in("fulfillment_status", ["ordered", "shipped"]).limit(500);
  if (error) throw new Error("Could not load orders");
  // `only`: CJ order codes or our order ids (CJ's orderNumber) named in a CJ notification.
  const wanted = only ? new Set(only) : null;
  const orders = ((data ?? []) as Order[]).filter((order) => CJ_ORDER_REF.test(order.supplier_order_ref ?? ""))
    .filter((order) => !wanted || wanted.has(order.id) || wanted.has(order.supplier_order_ref!))
    // Orders waiting for tracking first, then those in transit, oldest first.
    .sort((a, b) => (a.fulfillment_status === "ordered" ? 0 : 1) - (b.fulfillment_status === "ordered" ? 0 : 1) || a.created_at.localeCompare(b.created_at))
    .slice(0, limit);
  let checked = 0; let shipped = 0; let delivered = 0;
  for (const order of orders) {
    if (Date.now() - started > budgetMs) break;
    const state = await cjOrderDetail(order.supplier_order_ref!).catch(() => null);
    if (!state) continue;
    checked += 1;
    const status = order.fulfillment_status!;
    try {
      if (state.trackNumber && state.trackNumber !== order.tracking_number && /^[A-Za-z0-9-]{4,100}$/.test(state.trackNumber)) {
        await applyFulfillment(order.id, status, parseFulfillmentAction({
          action: "shipped", trackingNumber: state.trackNumber, carrier: state.carrier ?? "", trackingUrl: state.trackingUrl ?? "", notify: true,
        }));
        shipped += 1;
        if (state.status === "DELIVERED") { await applyFulfillment(order.id, "shipped", { action: "delivered" }); delivered += 1; }
      } else if (state.status === "DELIVERED" && status === "shipped") {
        await applyFulfillment(order.id, "shipped", { action: "delivered" });
        delivered += 1;
      }
    } catch (failure) {
      // A tracking email that didn't send leaves the order shipped; the owner can resend it from Fulfilment.
      console.error("CJ order sync failed for one order", failure instanceof Error ? failure.message.slice(0, 160) : "");
    }
  }
  return { checked, shipped, delivered };
}
