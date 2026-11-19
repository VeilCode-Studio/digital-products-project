import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, TicketPercent } from "lucide-react";
import { CopyCode } from "@/components/site/copy-code";
import { formatMoney } from "@/lib/store-config";
import type { ThankYouOffers as Offers } from "@/lib/thank-you-offers";
import "./thank-you-offers.css";

const coverOf = (id: string, revision: number) => `/api/products/${encodeURIComponent(id)}/cover/${revision}`;
const ends = (value: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(value));

/**
 * The thank-you add-ons: a code for next time and, after a digital purchase, up to two products that
 * pair with it. Self-styled (thank-you-offers.css) so it sits inside either thank-you page.
 */
export function ThankYouOffers({ offers, accent }: { offers: Offers; accent?: string }) {
  if (!offers.code && !offers.products.length) return null;
  return <section className="tyo" aria-labelledby="tyo-title" style={accent ? { ["--tyo-accent" as string]: accent } : undefined}>
    <h2 id="tyo-title" className="tyo-title">{offers.products.length ? "Pairs well with your order" : "A thank-you for next time"}</h2>
    {offers.code && <div className="tyo-code">
      <span className="tyo-code-icon" aria-hidden="true"><TicketPercent size={20} /></span>
      <div><strong>{offers.code.description} your next order</strong><span>Use the code at checkout{offers.code.endsAt ? ` before ${ends(offers.code.endsAt)}` : ""}.</span></div>
      <CopyCode code={offers.code.code} />
    </div>}
    {offers.products.length > 0 && <ul className="tyo-products">
      {offers.products.map((product) => <li key={product.id}>
        <Link href={`/p/${product.slug}`} className="tyo-product">
          {product.cover_path && <span className="tyo-cover"><Image src={coverOf(product.id, product.revision)} alt="" width={240} height={240} sizes="120px" /></span>}
          <span className="tyo-info">
            <strong>{product.name}</strong>
            {product.tagline && <span>{product.tagline}</span>}
            <em>{product.price_amount !== null ? formatMoney(product.price_amount, product.currency) : ""} <ArrowUpRight size={15} aria-hidden="true" /></em>
          </span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}
