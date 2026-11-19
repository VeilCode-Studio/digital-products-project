"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Gift } from "lucide-react";

/** The consent wording, kept identical to lib/subscribers.ts CONSENT_TEXT (that copy is what gets recorded). */
const CONSENT = "Email me when there are new products and offers. Unsubscribe any time.";

/** "Get it free": an email address for the owner's chosen free download, with an optional, unticked opt-in. */
export function GiftSignup({ name, tagline }: { name: string; tagline: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState("sending"); setError("");
    try {
      const response = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, marketing, website }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setState("sent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong. Please try again.");
      setState("idle");
    }
  };

  return <section className="vc-gift vc-wrap" aria-labelledby={`${id}-title`} data-reveal>
    <div className="vc-gift-card">
      <div className="vc-gift-copy">
        <span className="vc-gift-icon" aria-hidden="true"><Gift size={20} /></span>
        <p className="vc-eyebrow">Free download</p>
        <h2 id={`${id}-title`} className="vc-gift-title">Get {name} free.</h2>
        {tagline && <p className="vc-gift-lede">{tagline}</p>}
      </div>
      {state === "sent" ? <div className="vc-gift-done" role="status">
        <span aria-hidden="true"><Check size={20} /></span>
        <div><strong>Check your inbox.</strong><p>The download link is on its way to {email}. It can take a minute; check spam if it doesn&apos;t show.</p></div>
      </div> : <form className="vc-gift-form" onSubmit={submit} noValidate>
        <label className="vc-gift-field" htmlFor={`${id}-email`}>
          <span>Email address</span>
          <input id={`${id}-email`} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
        </label>
        {/* Hidden from people; bots fill it in, and the server then quietly does nothing. */}
        <label className="vc-gift-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
        <label className="vc-gift-check">
          <input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
          <span>{CONSENT}</span>
        </label>
        {error && <p id={`${id}-error`} className="vc-gift-error" role="alert">{error}</p>}
        <button type="submit" className="vc-button" disabled={state === "sending" || !email.trim()}>{state === "sending" ? "Sending…" : <>Send it to me <ArrowRight size={18} aria-hidden="true" /></>}</button>
        <p className="vc-gift-fine">We only use your email to send the download{marketing ? " and the occasional update" : ""}. See our <Link href="/privacy">privacy policy</Link>.</p>
      </form>}
    </div>
  </section>;
}
