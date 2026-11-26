# Store domains: staging review

This release connects one primary hostname to each digital product or physical storefront. Physical storefronts are product records under the configured owner store. The Domains page is at `/admin/domains`; both product editors link to it.

## Staging first

Apply `supabase/migrations/20261126185410_store_domains.sql` to preview only. The table uses RLS with no browser grants or policies; access is server-only. The migration version matches the preview migration history.

In the staging branch's Vercel Preview environment, set:

```dotenv
CUSTOM_DOMAINS_ENABLED=true
DOMAIN_PURCHASE_PREVIEW=true
DOMAIN_PREVIEW_BRANCH=staging
DOMAIN_VERCEL_PROJECT_ID=<project ID>
DOMAIN_VERCEL_TEAM_ID=<team ID>
DOMAIN_VERCEL_TOKEN=<server-only scoped credential>
```

Leave production unchanged. Search uses Vercel's public Registrar search API and works without the provisioning credential. Connections remain disabled until all three provider variables exist. Never reuse a token in client code or log it.

Buying is a rehearsal: it retrieves current availability and registration/renewal quotes, displays a review dialog, and checks the registration price again before reporting an explicitly simulated result. No registrar purchase, renewal, payment, or DNS-write API is implemented. No contact or payment details are collected. The purchase UI and API are unavailable in production, even when the preview flag is set. Production enablement requires a future reviewed implementation, not an environment-variable change.

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
- Production denies both search and rehearsal, regardless of feature flags.
- Full purchase acceptance requires a later release covering registrant contacts, provider commercial terms, payment/registration reconciliation, renewals, transfers, and customer support. Never treat a successful rehearsal as domain registration.

References: [Vercel custom domains](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains), [Registrar API](https://vercel.com/docs/domains/registrar-api).
