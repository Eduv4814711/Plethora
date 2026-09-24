# WhatsApp Cloud API Production Deployment Guide

This document is the canonical reference for deploying and maintaining the official **Meta WhatsApp Business Platform Cloud API** integration for **Plethora ERP** in production on **Railway**.

---

## Architecture Overview

Plethora connects directly to the official **Meta WhatsApp Cloud API** via HTTPS:

```text
Employee WhatsApp
       ↕
Meta WhatsApp Cloud API (v26.0)
       ↕ HTTPS Webhook & Graph API
Plethora API on Railway
       ↕
PostgreSQL Database (Attendance, Rostering, Leave, Payroll)
```

No unofficial libraries, QR codes, headless browsers, or third-party wrappers (such as WAHA or WPPConnect) are permitted.

---

## Crucial Terminology & Secrets Distinction

Meta identifiers and secrets are easy to confuse. Review this table carefully before configuring your environment:

### Identifiers

| Identifier | What It Is | Where to Find It in Meta | Not To Be Confused With |
|------------|------------|--------------------------|-------------------------|
| **Phone Number ID** | Unique ID for the specific WhatsApp phone number sending/receiving messages | WhatsApp Manager → Phone Numbers (or WhatsApp → API Setup) | **WABA ID** or **App ID** |
| **WABA ID** | WhatsApp Business Account ID owning templates, phone numbers, and subscriptions | WhatsApp Manager → Settings (or Business Portfolio Settings) | **Phone Number ID** or **App ID** |
| **App ID** | Meta Developer App identifier | Meta Developer Dashboard header | **WABA ID** or **Phone Number ID** |

> [!WARNING]
> `Phone Number ID ≠ WABA ID ≠ App ID`. Using a WABA ID in place of a Phone Number ID will result in 400/404 errors on Graph API calls.

### Credentials & Tokens

| Token / Secret | Purpose | Where to Obtain / Set | Not To Be Confused With |
|----------------|---------|-----------------------|-------------------------|
| **Access Token** | Bearer token for API requests (`WHATSAPP_ACCESS_TOKEN`) | Meta System User with `whatsapp_business_messaging` and `whatsapp_business_management` permissions | **Verify Token** or **App Secret** |
| **Verify Token** | Shared secret string you invent (`WHATSAPP_VERIFY_TOKEN`) | Chosen by you and entered into both Plethora env and Meta Webhook setup | **Access Token** or **App Secret** |
| **App Secret** | Cryptographic key for HMAC validation (`WHATSAPP_APP_SECRET`) | Meta App Dashboard → App Settings → Basic → App Secret | **Access Token** or **Verify Token** |

> [!WARNING]
> `Access Token ≠ Verify Token ≠ App Secret`. Webhook signature verification uses the **App Secret** via HMAC-SHA256 (`X-Hub-Signature-256`), never the Verify Token or Access Token.

---

## Railway Production Configuration

Configure these environment variables on your **Railway API service**.

> [!IMPORTANT]
> - These variables must be set **only on the Railway API service**.
> - **Never** expose them on the frontend Next.js service or prefix them with `NEXT_PUBLIC_*`.
> - Meta servers must reach the **public HTTPS domain** of your API (e.g., `https://api.quickbophasecurity.co.za/webhook` or your public `https://xxx.up.railway.app/webhook`). Railway private/internal service domains cannot be reached by Meta.

### Environment Variable Template

```env
# WhatsApp Integration Switch
WHATSAPP_ENABLED=false

# Meta WhatsApp Cloud API Credentials
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WABA_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

# Meta Graph API Version (defaults to v26.0)
WHATSAPP_API_VERSION=v26.0
```

---

## Recommended Step-by-Step Deployment Sequence

The Plethora webhook architecture permits verification before enabling inbound processing, preventing chicken-and-egg deployment roadblocks.

### Step 1: Deploy API with WhatsApp Secrets

1. Add `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_APP_SECRET` to the Railway API service.
2. Keep `WHATSAPP_ENABLED=false` initially.
3. Deploy the service and verify public HTTPS reachability at `https://YOUR-API-DOMAIN/health`.

### Step 2: Configure Meta Webhook Verification

1. Go to [Meta for Developers](https://developers.facebook.com/) → Your App → **WhatsApp** → **Configuration**.
2. Click **Edit** under **Webhook**:
   - **Callback URL**: `https://api.quickbophasecurity.co.za/webhook` (or your public Railway API domain `https://YOUR-API-DOMAIN/webhook`).
   - **Verify Token**: Enter the exact string configured in `WHATSAPP_VERIFY_TOKEN`.
3. Click **Verify and Save**.
   - Plethora will verify the token and return HTTP 200 with the challenge even though `WHATSAPP_ENABLED=false`.
4. Click **Manage** under Webhook fields and subscribe to **messages**.

### Step 3: Subscribe App to WABA

Plethora includes an administrative endpoint to subscribe the app to your WABA:

```bash
curl -X POST https://api.quickbophasecurity.co.za/whatsapp/subscription \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

Alternatively, run Meta's Graph API subscription endpoint via curl (see examples below).

### Step 4: Verify Integration Health

Check the configuration status through Plethora's authenticated health endpoint:

```bash
curl -X GET https://api.quickbophasecurity.co.za/whatsapp/health?connectivity=true \
  -H "Authorization: Bearer <ADMIN_JWT_TOKEN>"
```

Expected response:

```json
{
  "enabled": false,
  "configured": true,
  "phoneNumberConfigured": true,
  "wabaConfigured": true,
  "accessTokenConfigured": true,
  "appSecretConfigured": true,
  "verifyTokenConfigured": true,
  "apiVersion": "v26.0",
  "metaApiReachable": true
}
```

### Step 5: Enable WhatsApp in Production

1. Update the Railway environment variable:
   ```env
   WHATSAPP_ENABLED=true
   ```
2. Redeploy the Railway API service.
3. Send a test message from a registered employee's mobile number (`help`).
4. Validate that the employee receives the interactive command menu.

---

## Meta Cloud API Reference Commands (curl)

Use `v26.0` for all Meta Cloud API requests.

### 1. Register Phone Number

```bash
curl -X POST "https://graph.facebook.com/v26.0/{PHONE_NUMBER_ID}/register" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "pin": "123456"
  }'
```

### 2. Subscribe Meta App to WABA

```bash
curl -X POST "https://graph.facebook.com/v26.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

### 3. Check Subscribed Apps

```bash
curl -X GET "https://graph.facebook.com/v26.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

### 4. Send Test Template Message

```bash
curl -X POST "https://graph.facebook.com/v26.0/{PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "27821234567",
    "type": "template",
    "template": {
      "name": "hello_world",
      "language": {
        "code": "en_US"
      }
    }
  }'
```

---

## Customer-Service Window & Messaging Rules

- **Within the 24-Hour Window**: Free-form text and interactive messages are permitted when the employee messaged the business within the preceding 24 hours.
- **Outside the 24-Hour Window**: Messages will fail with Meta error `131047`. Outbound messaging requires an approved **Message Template** (e.g. shift notifications, urgent broadcasts).
- Plethora returns `requiresTemplate: true` in the API when error `131047` occurs, instructing the dispatcher to select an approved template.

---

## Webhook Idempotency & Concurrency Safety

Meta may retry webhook deliveries if an acknowledgment takes too long or network interruptions occur.

Plethora enforces durable database-level deduplication:
- Each incoming Meta message ID (`wamid.HBg...`) is atomically inserted into `WhatsAppWebhookEvent` with a unique constraint on `metaEventId`.
- A duplicate of a `PROCESSED` event receives HTTP 200 without running the command again.
- A duplicate of a `PROCESSING` event receives HTTP 503 so Meta can retry after the first delivery finishes. If a business action succeeds but its completion status cannot be stored, the event stays `PROCESSING` and also receives HTTP 503.
- A `FAILED` event can be claimed for a retry. Claiming is atomic, so concurrent deliveries cannot run the same retry together.

An event can remain `PROCESSING` after a worker crash. Do not automatically replay an old `PROCESSING` event: an attendance or leave action may have committed before the crash. During rollout, inspect backend logs for `WhatsApp message processed, but completion could not be stored` and repeated webhook HTTP 503 responses. Investigate any `PROCESSING` row older than ten minutes alongside its attendance, leave, message, and audit records. Reconcile the business action before changing the event status or retrying it. The database query below identifies candidates without changing data:

```sql
SELECT "metaEventId", "eventType", "phoneNumberId", "receivedAt", "errorMessage"
FROM "WhatsAppWebhookEvent"
WHERE "status" = 'PROCESSING'
  AND "receivedAt" < now() - interval '10 minutes'
ORDER BY "receivedAt";
```

The long-term reliability fix is to make each command's business mutation idempotent by Meta message ID and commit it with its processing record. Until then, treat stale events as reconciliation work rather than automatic retries.

---

## Multi-Tenant Safety Invariant

Plethora is a multi-tenant platform:
- Inbound WhatsApp senders have no tenant header. Senders are mapped to employees via normalized international phone format (`27821234567`).
- If a phone number matches active employees across multiple companies (or multiple records within one company), **Plethora will never guess the tenant**. The event is rejected with an audit log warning.
