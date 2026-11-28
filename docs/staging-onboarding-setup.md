# Remaining staging setup

The implementation is deployed to staging. Production remains unchanged. These provider settings and consent steps are still required to finish end-to-end acceptance.

## Supabase signup and email

Use staging project `wbmrrbfnkfraagkvyics`, not the production project.

1. In Authentication → Sign In / Providers, enable **Allow new users to sign up**. Keep email confirmation enabled.
2. In Authentication → URL Configuration, allow these redirects:
   - `https://staging.pod.veilcode.studio/auth/confirm`
   - `https://staging.pod.veilcode.studio/auth/reset`
3. Verify that signup and recovery emails reach a real test inbox. The deployed recovery-session test passed, but it deliberately did not send email. Use the project's SMTP delivery settings if sending is restricted.
4. Enable leaked-password protection when supported by the project's plan. This remains a reported Supabase Auth advisory.

The application verifies the user with Supabase before creating an owned workspace or session cookies. It cannot enable the provider's signup setting itself. Production signup requires a separate application flag and remains closed.

## Stripe account linking

The sandbox Connect webhook is created and its signing secret is configured for the staging branch. The OAuth client ID is missing.

1. In the platform's Stripe Dashboard, open Connect settings → Onboarding options / OAuth and copy the client ID (`ca_…`). Use the test client ID if Stripe presents separate test and live IDs. This is different from an API key or webhook signing secret.
2. Add `https://staging.pod.veilcode.studio/api/admin/payments/stripe/callback` as an allowed test OAuth redirect.
3. Set `STRIPE_CONNECT_CLIENT_ID` in this Vercel project's Preview environment, restricted to Git branch `staging`, then redeploy staging.
4. Complete consent using an independent sandbox merchant account. Verify separate account ownership and a real sandbox merchant Checkout payment, signed webhook, order, email and download. Repeat with the second merchant; no store may use the platform payment account as a fallback.

Sandbox account creation works, but the synthetic test account still needs onboarding. Production Connect approval has not been established. An OAuth client ID cannot bypass Stripe's account or platform eligibility requirements.

## Hostinger DNS

The pending staging connection has been removed and reconnected successfully. To verify live routing and HTTPS for the unused subdomain, add only:

| Type | Name | Target | TTL |
| --- | --- | --- | --- |
| CNAME | `store-preview` | `026cb6b5ac77fcc4.vercel-dns-017.com` | `300` |

Leave the apex `answersteady.com`, `www`, mail records and existing website unchanged. After DNS propagates, use **Check status** in staging to verify ownership, DNS and HTTPS. Real domain purchases remain disabled in production.
