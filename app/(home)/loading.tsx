import { SiteHeader } from "@/components/site/chrome";
import { monaSans } from "../studio-fonts";
import "../studio.css";

// Shaped like the homepage itself: the real header, then the hero, the proof strip and the collection as placeholders,
// so the page settles into place instead of jumping from a generic loader.
export default function Loading() {
  return (
    <div className={`vc vc-sk-page ${monaSans.variable}`} aria-busy="true">
      <SiteHeader />
      <main>
        <span className="vc-sk-sr" role="status">Loading the studio</span>

        <section className="vc-hero vc-wrap" aria-hidden="true">
          <div className="vc-sk-copy">
            <i className="vc-sk vc-sk-eyebrow" />
            <i className="vc-sk vc-sk-display" />
            <i className="vc-sk vc-sk-display vc-sk-display-2" />
            <i className="vc-sk vc-sk-line" />
            <i className="vc-sk vc-sk-line" />
            <i className="vc-sk vc-sk-line vc-sk-line-short" />
            <div className="vc-actions vc-sk-actions">
              <i className="vc-sk vc-sk-button" />
              <i className="vc-sk vc-sk-link" />
            </div>
          </div>
          <div className="vc-stage vc-sk-stage">
            <i className="vc-sk vc-sk-on-cobalt vc-sk-cover" />
          </div>
        </section>

        <section className="vc-proof vc-wrap" aria-hidden="true">
          <ul>
            {[0, 1, 2, 3].map((item) => (
              <li key={item}>
                <i className="vc-sk vc-sk-icon" />
                <div className="vc-sk-stack">
                  <i className="vc-sk vc-sk-strong" />
                  <i className="vc-sk vc-sk-small" />
                  <i className="vc-sk vc-sk-small vc-sk-small-short" />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="vc-section vc-wrap" aria-hidden="true">
          <div className="vc-section-head">
            <i className="vc-sk vc-sk-heading" />
            <i className="vc-sk vc-sk-body" />
            <i className="vc-sk vc-sk-body vc-sk-body-short" />
          </div>
          <div className="vc-products">
            {[0, 1].map((card) => (
              <div key={card} className="vc-product vc-sk-card">
                <div className="vc-product-stage"><i className="vc-sk vc-sk-product-cover" /></div>
                <div className="vc-product-info">
                  <i className="vc-sk vc-sk-title" />
                  <i className="vc-sk vc-sk-small" />
                  <i className="vc-sk vc-sk-small vc-sk-small-short" />
                  <div className="vc-product-meta">
                    <i className="vc-sk vc-sk-price" />
                    <i className="vc-sk vc-sk-cta" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
