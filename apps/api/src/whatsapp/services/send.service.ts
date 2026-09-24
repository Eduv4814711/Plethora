import { config } from "../../lib/config.js";
import { normalizeWhatsAppPhone } from "../../lib/phone.js";

const GRAPH_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 15_000;

export type SendTextResult = {
  success: boolean;
  error?: string;
  messageId?: string;
  requiresTemplate?: boolean;
};

export async function sendText(to: string, text: string): Promise<SendTextResult> {
  if (!config.whatsapp.enabled) {
    console.warn("[WhatsApp] Not configured, skipping send");
    return { success: false, error: "WhatsApp is not configured" };
  }

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppPhone(to),
    type: "text",
    text: { preview_url: false, body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const resText = await res.text();

  if (!res.ok) {
    console.error("[WhatsApp] Send failed:", res.status, resText);
    let userError = "Failed to send message";
    let requiresTemplate = false;
    try {
      const errJson = JSON.parse(resText) as {
        error?: { message?: string; error_user_msg?: string; code?: number };
      };
      const msg = errJson?.error?.error_user_msg ?? errJson?.error?.message ?? resText;
      if (
        msg.includes("24 hour") ||
        msg.includes("messaging window") ||
        errJson?.error?.code === 131047
      ) {
        userError =
          "This contact hasn't messaged the business recently. Ask them to send a message to your WhatsApp Business number first, or use a template message.";
        requiresTemplate = true;
      } else {
        userError = msg.length > 200 ? "WhatsApp API error. Try opening WhatsApp directly." : msg;
      }
    } catch {
      userError = res.status === 403 ? "WhatsApp access denied" : userError;
    }
    return { success: false, error: userError, requiresTemplate };
  }

  let messageId: string | undefined;
  try {
    const json = JSON.parse(resText) as { messages?: [{ id?: string }] };
    messageId = json?.messages?.[0]?.id;
  } catch {
    // ignore
  }

  return { success: true, messageId };
}

export async function sendTemplate(
  to: string,
  templateName: string,
  languageCode: string = "en",
  components?: unknown[]
): Promise<SendTextResult> {
  if (!config.whatsapp.enabled) {
    console.warn("[WhatsApp] Not configured, skipping send");
    return { success: false, error: "WhatsApp is not configured" };
  }

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppPhone(to),
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components && components.length > 0 ? { components } : {}),
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const resText = await res.text();

  if (!res.ok) {
    console.error("[WhatsApp] Template send failed:", res.status, resText);
    let userError = "Failed to send template";
    try {
      const errJson = JSON.parse(resText) as { error?: { message?: string } };
      userError = errJson?.error?.message ?? resText;
    } catch {
      // ignore
    }
    return { success: false, error: userError };
  }

  let messageId: string | undefined;
  try {
    const json = JSON.parse(resText) as { messages?: [{ id?: string }] };
    messageId = json?.messages?.[0]?.id;
  } catch {
    // ignore
  }

  return { success: true, messageId };
}

export async function sendInteractiveButtons(
  to: string,
  bodyText: string,
  buttons: { id: string; title: string }[]
): Promise<SendTextResult> {
  if (!config.whatsapp.enabled) {
    console.warn("[WhatsApp] Not configured, skipping send");
    return { success: false, error: "WhatsApp is not configured" };
  }

  if (!buttons || buttons.length === 0) {
    return sendText(to, bodyText);
  }

  // Meta Cloud API supports at most 3 buttons with titles up to 20 chars
  const formattedButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply" as const,
    reply: {
      id: b.id.slice(0, 256),
      title: b.title.slice(0, 20),
    },
  }));

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppPhone(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: formattedButtons,
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const resText = await res.text();

  if (!res.ok) {
    console.error("[WhatsApp] Interactive buttons send failed:", res.status, resText);
    let userError = "Failed to send buttons";
    try {
      const errJson = JSON.parse(resText) as { error?: { message?: string } };
      userError = errJson?.error?.message ?? resText;
    } catch {
      // ignore
    }
    return { success: false, error: userError };
  }

  let messageId: string | undefined;
  try {
    const json = JSON.parse(resText) as { messages?: [{ id?: string }] };
    messageId = json?.messages?.[0]?.id;
  } catch {
    // ignore
  }

  return { success: true, messageId };
}

export async function sendInteractiveList(
  to: string,
  bodyText: string,
  buttonText: string,
  rows: { id: string; title: string; description?: string }[]
): Promise<SendTextResult> {
  if (!config.whatsapp.enabled) {
    console.warn("[WhatsApp] Not configured, skipping send");
    return { success: false, error: "WhatsApp is not configured" };
  }

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppPhone(to),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: [
          {
            title: "Commands",
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id.slice(0, 200),
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  const resText = await res.text();

  if (!res.ok) {
    console.error("[WhatsApp] Interactive list send failed:", res.status, resText);
    let userError = "Failed to send message";
    try {
      const errJson = JSON.parse(resText) as { error?: { message?: string } };
      userError = errJson?.error?.message ?? resText;
    } catch {
      // ignore
    }
    return { success: false, error: userError };
  }

  let messageId: string | undefined;
  try {
    const json = JSON.parse(resText) as { messages?: [{ id?: string }] };
    messageId = json?.messages?.[0]?.id;
  } catch {
    // ignore
  }

  return { success: true, messageId };
}

export async function sendDocument(
  to: string,
  pdfBuffer: Buffer,
  filename: string
): Promise<boolean> {
  if (!config.whatsapp.enabled) {
    console.warn("[WhatsApp] Not configured, skipping send");
    return false;
  }

  const phoneNumberId = config.whatsapp.phoneNumberId;
  const uploadUrl = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${phoneNumberId}/media`;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append("file", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), filename);

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: form,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error("[WhatsApp] Media upload failed:", uploadRes.status, err);
    return false;
  }

  const uploadJson = (await uploadRes.json()) as { id?: string };
  const mediaId = uploadJson.id;
  if (!mediaId) {
    console.error("[WhatsApp] No media ID in upload response:", JSON.stringify(uploadJson));
    return false;
  }

  const messagesUrl = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppPhone(to),
    type: "document",
    document: { id: mediaId, filename },
  };

  const sendRes = await fetch(messagesUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    console.error("[WhatsApp] Document send failed:", sendRes.status, err);
    return false;
  }
  return true;
}
