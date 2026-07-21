# WhatsApp Production Configuration

This guide explains how to configure WhatsApp Cloud API for your production environment.

---

## Prerequisites

- API deployed with a **public Railway HTTPS URL**
- Meta Developer account with WhatsApp Business API access
- WhatsApp Business phone number (or test number for development)

---

## Step 1: Deploy Your API

Ensure your API is deployed on Railway and reachable at a stable HTTPS URL,
for example `https://your-api.up.railway.app` or `https://api.yourdomain.com`.

Test the health endpoint: `https://YOUR-API-URL/health` should return `{"status":"ok"}`.

---

## Step 2: Set Production Environment Variables

On the Railway API service, add these variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `WHATSAPP_PHONE_NUMBER_ID` | Your WhatsApp Business phone number ID from Meta | `123456789012345` |
| `WHATSAPP_ACCESS_TOKEN` | **Permanent** access token (see Step 4) | `EAAxxxx...` |
| `WHATSAPP_VERIFY_TOKEN` | Secret string you choose (used by Meta to verify webhook) | `plethora_whatsapp_verify_abc123` |
| `WHATSAPP_APP_SECRET` | Meta app secret used to verify signed webhook requests | Store as a Railway secret |
| `WHATSAPP_API_VERSION` | Meta API version (optional, default `v21.0`) | `v21.0` |

**Important:** Set the first four variables together. A partial production
configuration intentionally stops the API from starting. Use the same
`WHATSAPP_VERIFY_TOKEN` value when configuring the webhook in Meta (Step 3).
Obtain `WHATSAPP_APP_SECRET` from **Meta App Dashboard > App settings > Basic**;
it is different from both the access token and verify token. Never paste any of
these secret values into deployment logs or support messages.

---

## Step 3: Configure Meta Webhook

1. Go to [Meta for Developers](https://developers.facebook.com/) → Your App → **WhatsApp** → **Configuration**.
2. Under **Webhook**, click **Edit**.
3. Set:
   - **Callback URL**: `https://YOUR-PRODUCTION-API-URL/webhook`  
     Example: `https://your-api.up.railway.app/webhook`
   - **Verify token**: Same value as `WHATSAPP_VERIFY_TOKEN` in your env
4. Click **Verify and Save**.
5. Subscribe to **messages** (required for incoming messages and status updates).

---

## Step 4: Use a Permanent Access Token

The temporary token from Meta expires in 24 hours. For production, create a **permanent** token:

1. In Meta for Developers → Your App → **WhatsApp** → **API Setup**.
2. Under **System User** (or create one in Business Settings → Users → System Users):
   - Create a System User if needed.
   - Generate a token with `whatsapp_business_messaging` and `whatsapp_business_management` permissions.
3. Copy the token and set it as `WHATSAPP_ACCESS_TOKEN` in your production env.
4. Store it securely; you won’t see it again.

---

## Step 5: Verify Configuration

1. Redeploy your API so it picks up the new env vars.
2. In Meta, the webhook should verify successfully.
3. Send a test message to your WhatsApp Business number (e.g. `help`).
4. You should receive a reply from the bot.

---

## Template Messages (First Contact)

When a team member has not messaged your business in the last 24 hours, you must use a **template message** to initiate contact. Templates must be created and approved in Meta Business Manager:

1. Go to [Meta Business Suite](https://business.facebook.com) → **WhatsApp Manager** → **Message Templates**.
2. Create a template (e.g. `hello_world` is pre-approved for testing).
3. For custom templates, submit for approval. Once approved, the template name can be used in the dashboard.
4. Optional: Set `WHATSAPP_TEMPLATES` env var (comma-separated names) to customize the list, or `WHATSAPP_WABA_ID` to fetch templates from Meta's API.

---

## Database: Message History

The WhatsApp module stores conversation history in the `WhatsAppMessage` table.
Apply committed migrations through the deployment command:

```bash
npm run db:migrate:deploy --workspace=api
```

Do not use `prisma db push` against production.

---

## Quick Reference

| Item | Value |
|------|-------|
| Webhook URL | `https://YOUR-API-URL/webhook` |
| Verify token | Same as `WHATSAPP_VERIFY_TOKEN` |
| Supported commands | `clock in`, `clock out`, `payslip`, `leave`, `help` |
| Dashboard | `/whatsapp` - Message team members, view history |

---

## Troubleshooting

- **Webhook verification fails**: Ensure the callback URL is exactly `https://YOUR-API-URL/webhook` (no trailing slash). The API must be reachable from the internet.
- **403 Forbidden on verify**: The `hub.verify_token` from Meta must match `WHATSAPP_VERIFY_TOKEN` exactly.
- **Messages not received**: Confirm you’re subscribed to the **messages** webhook field.
- **Token expired**: Use a permanent token from a System User, not the temporary one from the API Setup page.
- **API reports an incomplete WhatsApp production configuration**: Add every variable named as missing in the startup error. To temporarily disable WhatsApp, remove `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_APP_SECRET` from the Railway API service, then redeploy. `WHATSAPP_API_VERSION` can remain.
