# Hamboard mobile auth Worker

This Worker owns only Google OAuth, refresh-token storage, and Hamboard login sessions.

It does not proxy Hamboard project, image, sync, or backup file bytes. The browser receives a short-lived Google access token from `/api/token` and continues to call Google Drive APIs directly.

## Required production shape

- Frontend: `https://app.hamboard.net` on Vercel
- Auth Worker custom domain: `https://auth.hamboard.net`
- Google OAuth redirect URI: `https://auth.hamboard.net/oauth/callback`
- D1 binding name: `DB`

Using the `auth.hamboard.net` custom domain keeps the HttpOnly session cookie first-party/same-site with the mobile frontend.

## D1

Create a D1 database named `hamboard-auth`, put its id into `wrangler.toml`, then apply `schema.sql`.

## Secrets

Configure these as Cloudflare Worker secrets, never source variables:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`

`TOKEN_ENCRYPTION_KEY` must be 32 random bytes encoded as base64. It encrypts Google refresh tokens with AES-GCM before D1 storage.

## Vercel

Set:

`HAMBOARD_AUTH_BASE_URL=https://auth.hamboard.net`

The old browser-side Google OAuth client-id variable is no longer used by the mobile build.

## Endpoints

- `GET /oauth/start`: starts the one-time Google authorization-code flow with offline access and PKCE.
- `GET /oauth/callback`: stores the encrypted refresh token and creates an HttpOnly session.
- `GET /api/session`: checks/rolls the Hamboard session.
- `POST /api/token`: refreshes and returns a short-lived Google access token.
- `POST /api/logout`: revokes the Google refresh token and removes the session.
- `GET /health`: Worker health only.

No Drive file upload/download endpoint exists by design.
