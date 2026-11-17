/** The PodStore mark (a P holding a seed) from public/brand/podstore-mark.svg, without its tile, drawn in currentColor. */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path d="M23 49V15h9.5a11 11 0 0 1 0 22H23" stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32.5" cy="26" r="3.6" fill="currentColor" />
    </svg>
  );
}
