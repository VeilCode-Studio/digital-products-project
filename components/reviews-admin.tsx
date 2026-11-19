"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, MessageSquareQuote, Star, Undo2 } from "lucide-react";

export type AdminReview = {
  id: string; rating: number; title: string | null; body: string | null; display_name: string;
  status: "pending" | "approved" | "hidden"; created_at: string; productName: string;
};

const TABS = [{ id: "pending", label: "Waiting" }, { id: "approved", label: "Published" }, { id: "hidden", label: "Hidden" }] as const;
const day = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));

function Stars({ rating }: { rating: number }) {
  return <span className="rv-stars" role="img" aria-label={`${rating} out of 5`}>{[1, 2, 3, 4, 5].map((value) => <Star key={value} size={15} aria-hidden="true" fill={value <= rating ? "currentColor" : "none"} />)}</span>;
}

/** The Reviews page (/admin/reviews): every review is from a paid order; publish or hide each one. */
export function ReviewsAdmin({ reviews }: { reviews: AdminReview[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminReview["status"]>(reviews.some((review) => review.status === "pending") ? "pending" : "approved");
  const [pending, setPending] = useState<string | null>(null);
  const shown = reviews.filter((review) => review.status === tab);
  const published = reviews.filter((review) => review.status === "approved");
  const average = published.length ? published.reduce((sum, review) => sum + review.rating, 0) / published.length : 0;

  const set = async (review: AdminReview, status: AdminReview["status"]) => {
    setPending(review.id);
    try {
      const response = await fetch("/api/admin/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", id: review.id, status }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      toast.success(status === "approved" ? "Review published" : status === "hidden" ? "Review hidden" : "Review moved back to waiting", { description: status === "approved" ? `It now shows on ${review.productName}.` : undefined });
      router.refresh();
    } catch (failure) { toast.error((failure as Error).message); }
    setPending(null);
  };

  return <>
    <div className="an-kpis">
      <div className="an-kpi"><span>Waiting for you</span><strong>{reviews.filter((review) => review.status === "pending").length}</strong><small>Not on your site yet</small></div>
      <div className="an-kpi"><span>Published</span><strong>{published.length}</strong><small>Showing on product pages</small></div>
      <div className="an-kpi"><span>Average rating</span><strong>{published.length ? average.toFixed(1) : "—"}</strong><small>Of published reviews</small></div>
      <div className="an-kpi"><span>All reviews</span><strong>{reviews.length}</strong><small>Every one from a paid order</small></div>
    </div>

    <section className="workspace-panel">
      <div className="panel-heading">
        <div className="rv-tabs" role="tablist" aria-label="Review status">
          {TABS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "active" : ""} onClick={() => setTab(entry.id)}>
            {entry.label} <span className="count">{reviews.filter((review) => review.status === entry.id).length}</span>
          </button>)}
        </div>
      </div>
      {shown.length ? <ul className="rv-list">{shown.map((review) => <li key={review.id}>
        <div className="rv-main">
          <div className="rv-top"><Stars rating={review.rating} /><span>{review.productName}</span></div>
          {review.title && <strong className="rv-title">{review.title}</strong>}
          {review.body ? <p>{review.body}</p> : <p className="rv-empty">Stars only, no written review.</p>}
          <small>{review.display_name} · {day(review.created_at)}</small>
        </div>
        <div className="rv-actions">
          {review.status !== "approved" && <button type="button" className="button primary small" disabled={pending === review.id} onClick={() => set(review, "approved")}><Check size={14} /> Publish</button>}
          {review.status !== "hidden" && <button type="button" className="button secondary small" disabled={pending === review.id} onClick={() => set(review, "hidden")}><EyeOff size={14} /> Hide</button>}
          {review.status === "hidden" && <button type="button" className="button secondary small" disabled={pending === review.id} onClick={() => set(review, "pending")}><Undo2 size={14} /> Back to waiting</button>}
        </div>
      </li>)}</ul>
        : <div className="empty-state"><MessageSquareQuote size={28} /><h3>{tab === "pending" ? "Nothing waiting." : tab === "approved" ? "No published reviews yet." : "Nothing hidden."}</h3><p>{tab === "pending" ? "Buyers are asked a few days after their order arrives, once per order. New reviews land here." : "Publish reviews from the Waiting tab."}</p></div>}
    </section>

    <div className="workspace-note"><Check size={16} /> Publishing honest reviews, including critical ones, builds more trust than a wall of five stars. Hide only reviews that are abusive, off-topic or share personal details.</div>
  </>;
}
