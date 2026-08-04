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

## Authorization

Access is a per-user map of module path → capabilities, stored on `User.capabilities`
and defined by `CAPABILITY_CATALOG` in `apps/api/src/lib/capabilities.ts`. Job titles
and account types grant nothing. The company owner bypasses the map entirely.

### Grants are exact

Capability lookup resolves a request path to the catalog module that owns it
(`resolveModulePath`) and then looks that module up **exactly**. A grant on a parent
module never confers a sub-module:

- `/settings` does **not** grant `/settings/access` (User Access) or `/settings/migrate`
- `/payroll` does **not** grant `/payroll/billing` (Client Billing)
- `/employees` does **not** grant `/employees/leave` (Leave)

Route guards follow the same rule: a route that owns a module's records requires that
module. A small number of guards deliberately accept a union of modules, and each says
why in a comment — Alerts and site timesheets (aggregate surfaces with no module of
their own), pay grades and pay periods (shared reference data), and global search
(which then filters each result set by its own module capability).

`manage_access` exists only on `/settings/access`, is never inherited, and can never be
delegated by a non-owner.

### Effective access and review

- `GET /users/:id/effective-access` — what a person can actually do, computed by the
  same function the guards use. Anyone may read their own; reading another's needs
  `/settings/access:view`. Surfaced as **View access** in Settings → User Access.
- `GET /users/access-review?format=csv` — company-wide user × module × capability
  matrix with last-login and never-logged-in flags, for periodic sign-off.

## Audit trail

`AuditLog` records who did what, when, from where, and whether it succeeded
(`outcome`: `success` | `denied` | `failure`). Every row written through
`auditFromRequest` carries the actor, IP address, user agent and request id, so audit
rows correlate with server logs. Pass a transaction client to write the audit row
atomically with the change it describes.

Recorded beyond ordinary record changes:

| Event | Action |
|---|---|
| Sign-in, failed sign-in, sign-out | `auth.login`, `auth.login.failed`, `auth.logout` |
| Password setup, rejected refresh, revoked session | `auth.password.setup`, `auth.token.refresh.rejected`, `auth.session.rejected` |
| Refused access attempt | `access.denied` (module, capability, method, route) |
| Use of a `view_sensitive` grant | `data.sensitive.view` (module, record count, fields) |
| Access granted or revoked | `user.create`, `user.access.update`, `user.deactivate` — each with a structured `added` / `removed` capability diff |
| Ownership transfer | `company.owner.transfer` |
| Audit and access-review exports | `audit.export`, `user.access_review.export` |

Denied-access rows are de-duplicated per actor + module + capability on a 5-minute
window so a polling UI cannot flood the table.

### Retention

`POST /internal/cron/audit-retention` prunes operational audit rows older than
`AUDIT_RETENTION_MONTHS` (default 24). Rows whose action starts with `access.`,
`auth.`, `user.` or `company.` are **never** pruned — that is the accountability
record itself.

**Known limitation:** `AuditLog.companyId` cascades on delete, so deleting a company
still erases its entire audit trail. Export the access review and audit CSV before
any company deletion.

## Route protection is enforced at the API

The web app has no `middleware.ts` and route gating is client-side, inside
`DashboardLayout`. This is deliberate: the API and web app are separate origins
(`NEXT_PUBLIC_API_URL`), and the refresh cookie is `SameSite=Strict` on the API's
domain, so Next.js middleware cannot read the session at all — a cookie-based gate
there would either be a no-op or lock out every user. Authorization is therefore
enforced entirely server-side, where capabilities are re-read from the database on
every request rather than trusted from the JWT. Client-side gating is a UX
convenience, never a security boundary.

## Operational checklist

| Item | Recommendation |
|------|----------------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Unique random strings ≥ 32 chars |
| `CORS_ORIGIN` | Exact web app origin(s), comma-separated |
| HTTPS | Required in production (Secure cookies) |
| `FRONTEND_URL` | Used for password-setup links |
| Rate limiting | Auth routes: 10 requests / 15 minutes |
| `CRON_SECRET` | Required for `/internal/cron/*`, including audit retention |
| `AUDIT_RETENTION_MONTHS` | Default 24; access and auth history is exempt |
| Access review | Export `/users/access-review?format=csv` periodically and trim unused grants |

## Reporting issues

Report security concerns to your platform administrator or the Plethora maintainers through your organisation’s usual channel.
