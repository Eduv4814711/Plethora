import FormData from "form-data";
import { config } from "../lib/config.js";

const GRAPH_URL = "https://graph.facebook.com";

export async function sendText(to: string, text: string): Promise<boolean> {
  if (!config.whatsapp.enabled) {
    console.warn("[WhatsApp] Not configured, skipping send");
    return false;
  }

  const url = `${GRAPH_URL}/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
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
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[WhatsApp] Send failed:", res.status, err);
    return false;
  }
  return true;
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
  form.append("file", pdfBuffer, {
    filename,
    contentType: "application/pdf",
  });

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: form as any,
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
    to: to.replace(/\D/g, ""),
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
  });

  if (!sendRes.ok) {
    const err = await sendRes.text();
    console.error("[WhatsApp] Document send failed:", sendRes.status, err);
    return false;
  }
  return true;
}
