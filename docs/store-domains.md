# Store domains

This release connects one primary hostname to each digital product or physical storefront. Physical storefronts are product records under the configured owner store. The Domains page is at `/admin/domains`; both product editors link to it.

## Staging first

Apply `supabase/migrations/20261126185410_store_domains.sql` to preview first, then production before enabling domain management there. The table uses RLS with no browser grants or policies; access is server-only. The migration is now applied in both environments with matching history versions.

In the staging branch's Vercel Preview environment, set:

```dotenv
CUSTOM_DOMAINS_ENABLED=true
DOMAIN_PURCHASE_PREVIEW=true
DOMAIN_PREVIEW_BRANCH=staging
DOMAIN_VERCEL_PROJECT_ID=<project ID>
DOMAIN_VERCEL_TEAM_ID=<team ID>
DOMAIN_VERCEL_TOKEN=<server-only scoped credential>
```

After reviewing staging, enable `DOMAIN_PURCHASE_PREVIEW=true` in production too to show the same search and simulated review interface. Production does not set `DOMAIN_PREVIEW_BRANCH`. Search uses Vercel's public Registrar search API and works without the provisioning credential. Connections remain disabled until all three provider variables exist. Never reuse a token in client code or log it.

Buying is a rehearsal: it retrieves current availability and registration/renewal quotes, displays a review dialog, and checks the registration price again before reporting an explicitly simulated result. No registrar purchase, renewal, payment, or DNS-write API is implemented. No contact or payment details are collected. The discovery/review UI works in both staging and production when enabled; its labels say purchase preview rather than staging preview. The flag never enables real buying, and the API does not accept a purchase action. Real registration requires a future reviewed implementation.

Search first uses the combined Registrar search endpoint. Its negative result can also mean a lookup or pricing failure, so the server falls back to the exact-domain availability endpoint before reporting unavailability. Confirmed available names get domain-specific pricing when needed. Failed availability checks return an unknown state; failed pricing never changes an available domain into an unavailable one. Only complete numeric registration/renewal quotes can enter the purchase rehearsal.

## Existing domains

1. Choose the product and enter a hostname without a URL scheme or path.
2. The server reserves a unique hostname/product mapping before adding it to Vercel. Preview assignments explicitly target the staging branch; existing assignments are never forcibly moved.
3. Add the DNS values displayed by the provider. Preserve existing email/DNS records.
4. Check connection. Activation requires provider ownership verification, correct DNS, and an unexpired matching certificate in the Vercel team. If certificate discovery is unavailable the domain stays pending.
5. Published products resolve at the domain root. Drafts remain private on the platform. A domain change does not reconfigure transactional email, webhooks, OAuth, or owner login.

If provisioning times out, the pending row is retained for reconciliation. Check connection before retrying. A failed initial add can be removed and retried; removing a pending row with no provider assignment is safe. Removal disables routing first, removes only the matching environment's project assignment, and then removes the mapping. It never cancels registration or changes the customer's DNS zone.

Routing blocks management APIs and other product pages on custom domains. Shopper requests require the custom host's own Origin and matching product. Platform requests retain their existing origin checks. Browser checkout returns use the product's active custom domain; checkout reservations retain the deployment's APP_URL for existing webhook isolation. Download, review, cancellation-email, and OAuth links continue to use the platform origin.

## Review checks

- Desktop and mobile domain settings; keyboard navigation and confirmation dialogs.
- Live search, unavailable/unknown result, registration versus renewal costs, premium domains, and simulated completion.
- Missing provider configuration, pending DNS, missing/expired certificate, and cross-environment rejection.
- Custom root/policy/checkout paths, blocked management APIs, and cross-product checkout rejection.
- Both environments require owner authentication and the platform Origin. Search/rehearsal require the preview feature flag, and neither can register domains or take payment.
- Full purchase acceptance requires a later release covering registrant contacts, provider commercial terms, payment/registration reconciliation, renewals, transfers, and customer support. Never treat a successful rehearsal as domain registration.

References: [Vercel custom domains](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains), [Registrar API](https://vercel.com/docs/domains/registrar-api).

## Search correction

Reproduced a false negative for `leadtokickoff.store` through the deployed staging search while direct Registrar checks confirmed it available. The combined endpoint does not distinguish unavailability from unsuccessful checks. Added exact-domain availability/pricing fallback and separate available, unavailable, and unknown UI states, including available-without-pricing. Also observed a 500 from an exact availability lookup; that now produces an unknown result instead of claiming the name is unavailable. Regression coverage includes the reported `.store`/`.com` names, provider failures/rate limits, malformed/missing search results, and incomplete pricing. The full suite now has 371 passing tests across 38 files.

## Purchase dialog review

Replaced the full-width purchase popup with a centered 480px maximum-width dialog, grouped domain/price summary, prominent preview total, concise copy and balanced actions. The shadcn Dialog/Checkbox/Button controls remain in use. Price-check errors now stay inside the open dialog. Browser-checked the real interactive component on desktop and in a 390px iframe, including renewal selection, inline error rendering and Escape dismissal. Temporary review routes were removed before deployment. Domain buying remains simulated and production remains unchanged.

## Staging verification — 26 November 2026

- Preview migration applied and checked: RLS enabled, anonymous reads denied, authenticated writes denied, service role allowed. Production schema unchanged.
- Deployed page returned 200 to an authenticated preview-owner session, showed the staging purchase panel, and loaded domain records successfully. Anonymous domain actions returned 401; an unrelated Origin returned 403.
- Live availability search returned a registration and renewal quote. The deployed rehearsal rechecked that quote and returned `simulated: true`, `charged: false`, `registered: false`. No registration or email was sent. The temporary test session was signed out afterward.
- Full test suite: 361 tests across 37 files. Lint and production build passed; the build retained an existing homepage filesystem-tracing warning.
- Desktop and 390px mobile layouts inspected using isolated fixtures of the real components. Browser access to staging itself remains protected by Vercel login.
- Real domain provisioning still requires `DOMAIN_VERCEL_TOKEN` in the staging branch's Preview scope and a user-owned test domain. No real DNS/HTTPS connection has been accepted end to end yet.
- The preview security advisor also reported existing unrelated findings: a backup table without RLS and disabled leaked-password protection. The new server-only domain table follows the project's intentional no-browser-policy model. See [RLS guidance](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public) and [password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
