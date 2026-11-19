"use client";
import { useState } from "react";
import { Check, Star } from "lucide-react";

type Initial = { rating: number; title: string; body: string; name: string };
const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** The buyer's review: stars first (all that's required), then optional words, and the name to show. */
export function ReviewForm({ token, productName, initial, editing }: { token: string; productName: string; initial: Initial; editing: boolean }) {
  const [rating, setRating] = useState(initial.rating);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [name, setName] = useState(initial.name);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const shown = hover || rating;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rating) { setError("Choose from 1 to 5 stars."); return; }
    setState("sending"); setError("");
    try {
      const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, rating, title, body, name }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      setState("sent");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Something went wrong."); setState("idle"); }
  };

  if (state === "sent") return <div className="vc-review-done" role="status">
    <span aria-hidden="true"><Check size={22} /></span>
    <h1 className="vc-heading">Thank you.</h1>
    <p className="vc-body">Your review of {productName} is in. It appears on the product page once we&apos;ve had a quick look, usually within a day.</p>
  </div>;

  return <>
    <p className="vc-eyebrow">{editing ? "Edit your review" : "Leave a review"}</p>
    <h1 className="vc-heading">How is {productName} working for you?</h1>
    <form className="vc-review-form" onSubmit={submit} noValidate>
      <fieldset className="vc-review-stars" onMouseLeave={() => setHover(0)}>
        <legend>Your rating</legend>
        <div>
          {[1, 2, 3, 4, 5].map((value) => <label key={value} onMouseEnter={() => setHover(value)} className={value <= shown ? "on" : ""}>
            <input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} />
            <Star size={34} aria-hidden="true" fill={value <= shown ? "currentColor" : "none"} />
            <span className="vc-sk-sr">{value} star{value === 1 ? "" : "s"}</span>
          </label>)}
          <span className="vc-review-word" aria-live="polite">{WORDS[shown]}</span>
        </div>
      </fieldset>
      <label className="vc-gift-field">
        <span>Headline <small>optional</small></span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="e.g. Saved me a weekend" />
      </label>
      <label className="vc-gift-field">
        <span>Your review <small>optional</small></span>
        <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={5} placeholder="What did you use it for? What did you like?" />
      </label>
      <label className="vc-gift-field">
        <span>Name to show</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} required placeholder="e.g. Sam K." autoComplete="name" />
      </label>
      {error && <p className="vc-gift-error" role="alert">{error}</p>}
      <button type="submit" className="vc-button" disabled={state === "sending"}>{state === "sending" ? "Sending…" : editing ? "Update review" : "Send review"}</button>
      <p className="vc-gift-fine">Shown with a “Verified buyer” label. We publish honest reviews, good or bad; we only remove ones that are abusive or share personal details.</p>
    </form>
  </>;
}
