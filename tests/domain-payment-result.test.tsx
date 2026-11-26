import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DomainPaymentResult } from "../components/domain-payment-result";
import type { DomainTestPayment } from "../lib/domain-types";

const initial: DomainTestPayment = { id: "cs_test_domain123", domain: "leadtokickoff.com", amount: 699, currency: "usd", status: "pending", checkoutUrl: "https://checkout.stripe.com/c/pay/test", failure: null };
it.each([
  ["paid", "Test payment successful"], ["failed", "Test payment failed"], ["pending", "Payment not completed"], ["processing", "Payment processing"], ["expired", "Test checkout expired"],
] as const)("displays %s distinctly without claiming domain registration", (status, title) => {
  const html = renderToStaticMarkup(<DomainPaymentResult initial={{ ...initial, status }} sessionId={initial.id} initialError="" returnedCancelled={false} />);
  expect(html).toContain(title);
  expect(html).toContain("Domain registration: not requested.");
  if (status !== "paid") expect(html).not.toContain("Test payment successful");
});
it("does not treat returning from cancellation as a successful payment", () => {
  const html = renderToStaticMarkup(<DomainPaymentResult initial={initial} sessionId={initial.id} initialError="" returnedCancelled />);
  expect(html).toContain("Checkout closed without payment confirmation");
  expect(html).not.toContain("Test payment successful");
});
