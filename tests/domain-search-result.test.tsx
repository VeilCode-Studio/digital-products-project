import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DomainSearchResult } from "../components/domains-view";
import type { DomainQuote } from "../lib/domain-types";

const render = (quote: DomainQuote) => renderToStaticMarkup(<DomainSearchResult quote={quote} pending={false} />);
it("keeps an available domain available when its price cannot be quoted", () => {
  const html = render({ domain: "leadtokickoff.store", available: true });
  expect(html).toContain("Available");
  expect(html).toContain("pricing could not be loaded");
  expect(html).not.toContain("currently unavailable");
  expect(html).not.toContain("Preview purchase");
});
it("distinguishes an unknown result from an unavailable domain", () => {
  const html = render({ domain: "leadtokickoff.com", available: null });
  expect(html).toContain("verify availability right now");
  expect(html).not.toContain("currently unavailable");
  expect(html).not.toContain("Preview purchase");
});
it("shows provider-confirmed unavailability without a purchase button", () => {
  const html = render({ domain: "leadtokickoff.com", available: false });
  expect(html).toContain("currently unavailable through our domain provider");
  expect(html).not.toContain("Preview purchase");
});
it("shows the registration and renewal quote for a confirmed available domain", () => {
  const html = render({ domain: "leadtokickoff.store", available: true, years: 1, price: 1.49, renewalPrice: 44 });
  expect(html).toContain("$1.49"); expect(html).toContain("$44.00");
  expect(html).not.toContain("Preview purchase");
  expect(html).not.toContain("Review and test payment");
  expect(html).toContain("Domain purchasing is not available yet.");
  expect(html).toContain("register it with a registrar");
});
it("offers payment testing only when the sandbox callback is supplied", () => {
  const html = renderToStaticMarkup(<DomainSearchResult quote={{ domain: "leadtokickoff.store", available: true, years: 1, price: 1.49, renewalPrice: 44 }} pending={false} onPreview={vi.fn()} />);
  expect(html).toContain("Review and test payment");
  expect(html).not.toContain("Domain purchasing is not available yet.");
});
