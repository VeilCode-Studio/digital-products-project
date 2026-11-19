// Public pages without a skeleton of their own (product, store and legal pages) show a slim progress line while they load.
// The homepage has its own page-shaped skeleton in app/(home)/loading.tsx.
export default function Loading() {
  return <div className="route-progress" role="status" aria-label="Loading" />;
}
