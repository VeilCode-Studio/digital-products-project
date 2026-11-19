import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/chrome";
import { ReviewForm } from "@/components/site/review-form";
import { reviewContext } from "@/lib/reviews";
import { monaSans } from "../studio-fonts";
import "../studio.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leave a review", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ token?: string; rating?: string }> };

/** Where the review request email leads: stars (pre-filled if a star in the email was tapped), a few words, a name. */
export default async function ReviewPage({ searchParams }: Props) {
  const { token, rating } = await searchParams;
  const context = await reviewContext(token).catch(() => null);
  const preset = Number(rating);
  return (
    <div className={`vc ${monaSans.variable}`}>
      <SiteHeader nav={false} />
      <main className="vc-wrap vc-unavailable vc-review">
        {!context ? <>
          <p className="vc-eyebrow">Reviews</p>
          <h1 className="vc-heading">This review link isn&apos;t valid.</h1>
          <p className="vc-body">It may be incomplete. Reply to your order email and we&apos;ll help.</p>
        </> : context.review && context.review.status !== "pending" ? <>
          <p className="vc-eyebrow">Reviews</p>
          <h1 className="vc-heading">Thanks, your review is live.</h1>
          <p className="vc-body">It helps other people decide. We really appreciate it.</p>
        </> : <ReviewForm token={token!} productName={context.productName.split(":")[0].trim()}
          initial={{
            rating: context.review?.rating ?? (Number.isInteger(preset) && preset >= 1 && preset <= 5 ? preset : 0),
            title: context.review?.title ?? "", body: context.review?.body ?? "", name: context.review?.display_name ?? context.suggestedName,
          }} editing={!!context.review} />}
      </main>
    </div>
  );
}
