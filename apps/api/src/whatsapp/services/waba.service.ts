import { config } from "../../lib/config.js";

const GRAPH_URL = "https://graph.facebook.com";

export type WabaSubscriptionResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

/**
 * Subscribes the Meta application to the configured WhatsApp Business Account (WABA).
 * Meta endpoint: POST /{WABA_ID}/subscribed_apps
 */
export async function subscribeAppToWaba(): Promise<WabaSubscriptionResult> {
  if (!config.whatsapp.wabaId) {
    return {
      success: false,
      error: "WhatsApp WABA ID is not configured. Set WHATSAPP_WABA_ID in environment.",
    };
  }

  if (!config.whatsapp.accessToken) {
    return {
      success: false,
      error: "WhatsApp Access Token is not configured. Set WHATSAPP_ACCESS_TOKEN in environment.",
    };
  }

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.wabaId}/subscribed_apps`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
      },
    });

    const resText = await res.text();

    if (!res.ok) {
      console.error("[WhatsApp WABA] Subscription failed. HTTP status:", res.status);
      let errorMsg = `Meta API returned HTTP ${res.status}`;
      try {
        const json = JSON.parse(resText) as { error?: { message?: string } };
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // ignore parse error
      }
      return { success: false, error: errorMsg };
    }

    let data: unknown;
    try {
      data = JSON.parse(resText);
    } catch {
      data = { success: true };
    }

    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error contacting Meta API";
    console.error("[WhatsApp WABA] Network error subscribing app to WABA");
    return { success: false, error: message };
  }
}

/**
 * Checks currently subscribed apps for the configured WhatsApp Business Account (WABA).
 * Meta endpoint: GET /{WABA_ID}/subscribed_apps
 */
export async function getSubscribedApps(): Promise<WabaSubscriptionResult> {
  if (!config.whatsapp.wabaId) {
    return {
      success: false,
      error: "WhatsApp WABA ID is not configured. Set WHATSAPP_WABA_ID in environment.",
    };
  }

  if (!config.whatsapp.accessToken) {
    return {
      success: false,
      error: "WhatsApp Access Token is not configured. Set WHATSAPP_ACCESS_TOKEN in environment.",
    };
  }

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.wabaId}/subscribed_apps`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
      },
    });

    const resText = await res.text();

    if (!res.ok) {
      console.error("[WhatsApp WABA] Fetching subscribed apps failed. HTTP status:", res.status);
      let errorMsg = `Meta API returned HTTP ${res.status}`;
      try {
        const json = JSON.parse(resText) as { error?: { message?: string } };
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // ignore parse error
      }
      return { success: false, error: errorMsg };
    }

    let data: unknown;
    try {
      data = JSON.parse(resText);
    } catch {
      data = [];
    }

    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error contacting Meta API";
    console.error("[WhatsApp WABA] Network error fetching subscribed apps");
    return { success: false, error: message };
  }
}
