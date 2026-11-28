import { ownerPage } from "@/lib/auth";
import { workspaceForUser } from "@/lib/workspace";
import { listProducts } from "@/lib/catalog";
import { listReviews } from "@/lib/reviews";
import { NavSection } from "@/components/admin-nav";
import { ReviewsAdmin, type AdminReview } from "@/components/reviews-admin";
import "../../reviews.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const owner = await ownerPage();
  const { storeId } = await workspaceForUser(owner.id);
  const [reviews, products] = await Promise.all([listReviews(storeId).catch(() => null), listProducts(false, undefined, storeId)]);
  const names = new Map(products.map((product) => [product.id, product.name]));
  return <><NavSection href="/admin/reviews" />
    <div className="admin-page-heading">
      <div><span className="eyebrow">FROM PEOPLE WHO BOUGHT</span><h1>Reviews</h1><p>Buyers are asked once, a few days after their order arrives. Publish the reviews you want on your product pages.</p></div>
    </div>
    {reviews ? <ReviewsAdmin reviews={reviews.map((review): AdminReview => ({
      id: review.id, rating: review.rating, title: review.title, body: review.body, display_name: review.display_name,
      status: review.status, created_at: review.created_at, productName: names.get(review.product_id) ?? "Deleted product",
    }))} />
      : <section className="workspace-panel workspace-error" role="alert"><span className="eyebrow">TRY AGAIN SHORTLY</span><h1>Reviews couldn&apos;t load.</h1><p>Reload the page in a moment.</p></section>}
  </>;
}
