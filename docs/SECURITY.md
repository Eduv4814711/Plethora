# Plethora Security

## Authentication

### Access tokens (short-lived)

- JWT access tokens expire in **15 minutes**.
- The web app keeps the access token **in memory only** (React state). It is not written to `localStorage` or `sessionStorage`.
- API requests send `Authorization: Bearer <accessToken>`.

### Refresh tokens (HttpOnly cookies)

- Refresh tokens are **7-day** JWTs stored server-side (hashed in `RefreshToken` table) and issued to the browser as an **HttpOnly** cookie (`plethora_refresh`).
- Cookie attributes:
  - `HttpOnly: true` — not readable by JavaScript (mitigates XSS token theft).
  - `SameSite=Strict` — mitigates cross-site request forgery for cookie-authenticated requests.
  - `Secure: true` in production (`NODE_ENV=production`) — HTTPS only.
  - `Path=/` — sent to API routes on the configured API domain.

The JSON response from `/auth/login`, `/auth/onboard`, and `/auth/refresh` **does not include** `refreshToken`.

### CSRF protection

Cookie-based refresh and logout use a **double-submit** pattern:

| Cookie | HttpOnly | Purpose |
|--------|----------|---------|
| `plethora_refresh` | Yes | Refresh JWT |
| `plethora_csrf` | No | CSRF token (readable by the SPA) |

For `/auth/refresh` and `/auth/logout`, when the refresh cookie is present the client must send header `X-CSRF-Token` matching the `plethora_csrf` cookie value.

**Legacy migration:** If the client sends `refreshToken` in the JSON body only (no refresh cookie), CSRF is not required. This supports a one-time upgrade from older clients that stored refresh tokens in `localStorage`.

### Logout

- `POST /auth/logout` requires a valid access token (Bearer) and revokes the refresh token (cookie or body).
- Clears `plethora_refresh` and `plethora_csrf` cookies.

### Environment validation

Production startup validates secrets via `apps/api/src/lib/env.ts` (see `docs/ARCHITECTURE_IMPROVEMENT_PLAN.md`). JWT secrets must be ≥ 32 characters, distinct, and not use placeholder values.

## Frontend session bootstrap

On load, the web app:

1. Removes any legacy `plethora_refresh_token` / `plethora_access_token` from `localStorage`.
2. If a legacy refresh token existed, sends it **once** in the refresh request body.
3. Otherwise calls `/auth/refresh` with cookies only.
4. Stores the new access token in memory and schedules proactive refresh before expiry.

## Operational checklist

| Item | Recommendation |
|------|----------------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Unique random strings ≥ 32 chars |
| `CORS_ORIGIN` | Exact web app origin(s), comma-separated |
| HTTPS | Required in production (Secure cookies) |
| `FRONTEND_URL` | Used for password-setup links |
| Rate limiting | Auth routes: 10 requests / 15 minutes |

## Reporting issues

Report security concerns to your platform administrator or the Plethora maintainers through your organisation’s usual channel.
