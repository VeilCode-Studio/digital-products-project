import { Star } from "lucide-react";
import type { PublicReview } from "@/lib/reviews";

function Stars({ rating, size = 16 }: { rating: number; size?: number }) {
  const filled = Math.round(rating);
  return <span className="vc-stars" role="img" aria-label={`Rated ${rating} out of 5`}>
    {[1, 2, 3, 4, 5].map((value) => <Star key={value} size={size} aria-hidden="true" fill={value <= filled ? "currentColor" : "none"} />)}
  </span>;
}

/** Approved buyer reviews on a digital product page. Every one comes from a paid order. */
export function ProductReviews({ reviews, average }: { reviews: PublicReview[]; average: number }) {
  if (!reviews.length) return null;
  return <section className="vc-reviews vc-wrap" aria-labelledby="vc-reviews-title">
    <div className="vc-reviews-head">
      <h2 id="vc-reviews-title">What buyers say</h2>
      <p className="vc-reviews-score"><Stars rating={average} size={18} /><strong>{average.toFixed(1)}</strong> from {reviews.length} verified review{reviews.length === 1 ? "" : "s"}</p>
    </div>
    <ul className="vc-reviews-list">
      {reviews.map((review) => <li key={review.id}>
        <Stars rating={review.rating} />
        {review.title && <h3>{review.title}</h3>}
        {review.body && <p>{review.body}</p>}
        <p className="vc-reviews-by"><strong>{review.display_name}</strong><span>Verified buyer</span></p>
      </li>)}
    </ul>
  </section>;
}
