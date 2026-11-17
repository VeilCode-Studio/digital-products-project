"use client";

import { ShoppingBag } from "lucide-react";

/** Fired by the header button; the product hero opens its cart and cancels the event. */
export const OPEN_CART_EVENT = "st:open-cart";

/**
 * The header's shop button. On the store page the product hero answers the event and opens the
 * cart; anywhere else (policies, order confirmation) nothing answers, so the link goes to the buy box.
 */
export function CartButton({ href, label }: { href: string; label: string }) {
  return (
    <a className="st-button small st-cart-button" href={href} onClick={(event) => {
      const opened = !window.dispatchEvent(new CustomEvent(OPEN_CART_EVENT, { cancelable: true }));
      if (opened) event.preventDefault();
    }}>
      <ShoppingBag size={16} aria-hidden />{label}
    </a>
  );
}
