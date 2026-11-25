"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, PackageSearch, RefreshCw, ShoppingCart } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { CjPlan } from "@/lib/cj-orders";

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const days = (min: number | null, max: number | null) => max ? `${min && min !== max ? `${min}–` : ""}${max} days` : "time not given";

async function cjApi<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/admin/fulfillment/cj", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "CJ couldn't be reached. Please try again.");
  return data as T;
}

/** Orders a CJ-linked order from CJ: price it first, choose shipping, confirm, then place and pay. */
export function CjOrderPanel({ orderId, orderRef }: { orderId: string; orderRef: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<CjPlan | null>(null);
  const [method, setMethod] = useState("");
  const [pending, setPending] = useState<"plan" | "place" | null>(null);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const placeButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);

  async function price() {
    setPending("plan"); setMessage(null);
    try {
      const { plan: next } = await cjApi<{ plan: CjPlan }>({ action: "plan", orderId });
      setPlan(next); setMethod(next.suggested ?? "");
    } catch (error) { setMessage({ text: (error as Error).message, failed: true }); } finally { setPending(null); }
  }

  async function place() {
    setPending("place"); setMessage(null);
    try {
      const placed = await cjApi<{ message: string }>({ action: "place", orderId, logisticName: method });
      setConfirming(false); setPlan(null);
      setMessage({ text: placed.message, failed: false });
      router.refresh();
    } catch (error) {
      setConfirming(false);
      setMessage({ text: (error as Error).message, failed: true });
      router.refresh();
    } finally { setPending(null); }
  }

  const chosen = plan?.methods.find((option) => option.name === method) ?? null;
  const total = plan && chosen ? plan.productTotal + chosen.cost : null;
  const blocking = plan?.problems.filter((problem) => !problem.startsWith("An earlier attempt")) ?? [];
  const short = plan?.balance !== null && plan?.balance !== undefined && total !== null && plan.balance < total;

  return <div className="cj-order">
    {!plan ? <button type="button" className="button primary small" disabled={!!pending} onClick={price}>
      {pending === "plan" ? <Loader2 className="spin" size={14} /> : <PackageSearch size={14} />}{pending === "plan" ? "Asking CJ…" : "Order on CJ"}
    </button> : <div className="cj-plan">
      <ul className="cj-lines">{plan.lines.map((line) => <li key={line.variantId}>
        <span>{line.quantity} × {line.name}{line.label ? ` · ${line.label}` : ""}</span>
        <span>{line.unitCost !== null ? usd(line.unitCost * line.quantity) : "—"}{typeof line.stock === "number" ? <small>{line.stock.toLocaleString("en-US")} at CJ{line.usStock ? `, ${line.usStock.toLocaleString("en-US")} in US` : ""}</small> : null}</span>
      </li>)}</ul>
      {plan.problems.map((problem) => <p key={problem} className="form-error">{problem}</p>)}
      {plan.methods.length > 0 && <fieldset className="cj-methods">
        <legend>Shipping from {plan.from === "US" ? "CJ's US warehouse" : "China"}{plan.promisedDays ? ` · you promised up to ${plan.promisedDays} business days` : ""}</legend>
        {plan.methods.slice(0, 6).map((option) => <label key={option.name} className="fulfil-check">
          <input type="radio" name={`cj-method-${orderId}`} value={option.name} checked={method === option.name} onChange={() => setMethod(option.name)} />
          <span>{option.name}<small>{usd(option.cost)} · {days(option.minDays, option.maxDays)}{plan.promisedDays && option.maxDays && option.maxDays > plan.promisedDays ? " · slower than promised" : ""}</small></span>
        </label>)}
      </fieldset>}
      {total !== null && <p className="cj-total"><strong>About {usd(total)}</strong> to CJ{plan.sandbox ? " · sandbox: never charged" : plan.balance !== null ? ` · balance ${usd(plan.balance)}` : ""}</p>}
      {short && <p className="form-error">Your CJ balance won&apos;t cover this. Top up your CJ wallet first.</p>}
      <div className="fulfil-row">
        <button type="button" ref={placeButton} className="button primary small" disabled={!!pending || !chosen || blocking.length > 0 || short} onClick={() => setConfirming(true)}>
          <ShoppingCart size={14} />{plan.sandbox ? "Place sandbox order" : "Place and pay on CJ"}
        </button>
        <button type="button" className="text-button" disabled={!!pending} onClick={price}><RefreshCw size={13} /> Refresh prices</button>
      </div>
    </div>}
    {message && <p role="status" className={message.failed ? "form-error" : "save-success"}>{!message.failed && <Check size={15} />}{message.text}</p>}

    <AlertDialog open={confirming} onOpenChange={(open) => { if (!pending) setConfirming(open); }}>
      <AlertDialogContent className="confirm-dialog" initialFocus={keepButton} finalFocus={placeButton}>
        <div className="confirm-dialog-icon" aria-hidden="true"><ShoppingCart size={22} /></div>
        <AlertDialogHeader>
          <AlertDialogTitle>{plan?.sandbox ? `Place a sandbox order for ${orderRef}?` : `Order ${orderRef} from CJ?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {plan?.sandbox
              ? "This is a test environment, so CJ creates a sandbox order that's never paid or shipped."
              : `CJ ships it with ${chosen?.name ?? "the chosen method"} and takes about ${total !== null ? usd(total) : "the total"} from your CJ balance. The order moves to Ordered and you'll get tracking from CJ.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={keepButton} className="button secondary" disabled={!!pending}>Not yet</AlertDialogCancel>
          <AlertDialogAction type="button" className="button primary" disabled={!!pending} onClick={place}>
            {pending === "place" ? <Loader2 className="spin" size={15} /> : <ShoppingCart size={15} />}{pending === "place" ? "Placing…" : plan?.sandbox ? "Place sandbox order" : "Place and pay"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

/** Asks CJ for tracking and delivery on every CJ order now, instead of waiting for the daily check. */
export function CjSyncButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  return <div className="cj-sync">
    <button type="button" className="button secondary small" disabled={pending} onClick={async () => {
      setPending(true); setMessage(null);
      try {
        const result = await cjApi<{ checked: number; shipped: number; delivered: number; skipped?: string }>({ action: "sync" });
        setMessage({ text: result.skipped ? "CJ isn't connected in this environment."
          : !result.checked ? "No CJ orders to check." : `Checked ${result.checked} CJ order${result.checked === 1 ? "" : "s"}: ${result.shipped} shipped, ${result.delivered} delivered.`, failed: false });
        router.refresh();
      } catch (error) { setMessage({ text: (error as Error).message, failed: true }); } finally { setPending(false); }
    }}>{pending ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}{pending ? "Checking CJ…" : "Check CJ for tracking"}</button>
    {message && <p role="status" className={message.failed ? "form-error" : "muted"}>{message.text}</p>}
  </div>;
}
