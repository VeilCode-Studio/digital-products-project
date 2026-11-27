# Domain and user onboarding delivery

The requested outcome is a working domain flow and an application that onboards independent users. This document records the full acceptance scope; shipping a sandbox or hiding unfinished buttons does not satisfy it. Changes are reviewed in staging before production release.

## Domains

- Verify provider configuration against the intended project, with clear authentication, permission and availability failures. Missing or unusable credentials must not create pending domain records.
- Connect a domain the store owner already owns. Preserve other project assignments and DNS records. Display provider DNS instructions and distinguish pending ownership, DNS and HTTPS from active routing.
- Search available names with accurate availability, registration and renewal quotes. Unknown provider results are not unavailable domains.
- Implement buying: collect and validate the registrar's required contact fields, record the reviewed domain/term/price/renewal choice and target store, create checkout, verify payment with signed webhooks, reconcile registrar orders, connect the purchased domain and show distinct payment/registration/connection states.
- Persist purchase operations and provider order IDs. Retries, duplicate webhooks and timeouts cannot create a duplicate charge or registration. Failed registration after payment requires a tracked refund or explicit reconciliation state. A successful payment alone never means the domain is registered.
- Verify staging success, payment decline/retry, registration failure/refund, provider timeout/reconciliation, price changes, DNS/HTTPS pending and removal. A real non-refundable registrar purchase requires the user's specific purchase authorization; implementation authorization does not authorize spending.

## Independent users and stores

- Verified signup/login, password recovery and renewable sessions, with a separate workspace/store owned by each user. New signup cannot claim or reassign the existing store.
- Derive authorization from verified user identity and database ownership. Never trust a browser-supplied store ID, user metadata, or the configured legacy owner as general tenant authorization.
- Replace fixed-store assumptions throughout management, catalog, files, storage, domains, payments, orders, reports and assistant integrations. Public storefronts need unambiguous per-store URLs; existing public URLs continue to resolve to the legacy store.
- Resolve custom domains to their database store/product mapping. Keep management and unrelated products unavailable on custom domains.
- Unconnected new stores cannot fall back to the platform's Stripe account. Preserve merchant account context in checkout, orders, refunds, webhooks and fulfillment.
- Apply and verify database constraints/RLS and storage isolation in staging first. Test two unrelated users/stores against every sensitive operation and public/draft boundary before opening signup.
- Verify onboarding end to end with two disposable staging users: independent store creation, product creation, domain ownership, separate payment setup, public storefront and cross-store denials. Do not open public production signup while tenant-sensitive paths still use a fixed store.

## Current evidence and remaining work

- Production supports live availability/prices and connecting existing domains. Domain purchasing remains disabled there pending staging review.
- Staging readiness now verifies read access to the intended Vercel project before reserving a domain record. Verified against the configured credential; this is not proof of DNS/HTTPS or registrar purchase permissions.
- Added the server-only purchase journal in staging (`20261127050414_domain_purchase_operations`). Real database tests run as `service_role` inside a rollback transaction and verify ownership/product constraints, immutable quotes/provider references, single-use registration claims, refusal to retry uncertain registrations, refund references, terminal states and contact cleanup. Anonymous/authenticated roles cannot read or claim purchases.
- The working implementation wires a registrant form and immutable quote/terms/scenario review to Stripe Checkout, signed webhook fulfillment, registrar order tracking, refunds and separate payment/registration/connection results. Sandbox registration cannot call the real purchase endpoint or attach domains. Live purchasing requires an explicit production-only flag and live Stripe key; it is not enabled or verified in production.
- Staging migration `20261127053522_domain_purchase_simulation_scenarios` freezes the reviewed terms version and simulation scenario, rejects simulated live purchases and prevents multiple in-flight purchases for the same hostname/mode. Transactional SQL checks passed as service_role; they roll back all records.
- Recovery includes signed-webhook adoption of a lost checkout binding, immutable Stripe idempotency keys, owner-triggered reconciliation and a daily fallback worker. Unknown registrar submissions never retry a buy automatically. Refund timeouts remain pending with the same idempotency key; late uncertain refunds require review. The daily worker is a fallback, not the primary fulfillment trigger.
- Remaining domain validation: deploy and enable this flow only in staging; verify hosted Checkout decline/retry, registration success, failure/refund and uncertain outcomes against real sandbox services; verify owned-domain DNS/HTTPS and removal. The live path still needs provider timeout/budget validation and review before enabling real purchases. Registration quotes currently reflect registrar prices without an added platform fee; payment processing costs need a business decision before production purchasing.
- Existing authentication allows a configured owner only; store operations broadly use a constant store ID. This isolation refactor and user onboarding remain required, not complete.
- Production stays on the existing release while this goal is implemented and reviewed.

## Security gates before public signup

The staging advisor reports an existing backup table with RLS disabled and leaked-password protection disabled. These remain onboarding hardening work; no backup data was inspected or changed in the domain journal migration. References: [RLS-disabled remediation](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

The journal's RLS-enabled/no-policy informational notice is intentional: browser roles have no grants, there are no client read/write policies, and all operations require the server's verified owner context. [RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
