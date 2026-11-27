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

- Existing release supports live availability/prices and Stripe sandbox payment outcomes. Live registrar purchase/fulfillment is missing.
- Existing domain readiness checks only environment-variable presence. Provider verification and safe preflight are the first implementation changes on `feat/domain-onboarding`.
- Existing authentication allows a configured owner only; store operations broadly use a constant store ID. This isolation refactor and user onboarding remain required, not complete.
- Production stays on the existing release while this goal is implemented and reviewed.
