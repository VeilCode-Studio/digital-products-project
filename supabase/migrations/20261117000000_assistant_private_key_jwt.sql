-- ChatGPT's published client details (https://chatgpt.com/oauth/client.json) sign token requests with a
-- private key (private_key_jwt) and publish the matching public keys at a jwks_uri. Keep that address
-- with the client so the token endpoint can check the signature (lib/mcp/oauth.ts).
begin;

alter table public.mcp_clients add column jwks_uri text check (jwks_uri is null or jwks_uri ~ '^https://');

commit;
