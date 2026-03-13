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

  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/88a7285e-a4b7-491f-ab73-2cd80dfe89c9", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8a22f4" },
    body: JSON.stringify({
      sessionId: "8a22f4",
      location: "whatsapp-send.service.ts:sendDocument",
      message: "Before upload",
      data: { pdfBufferLen: pdfBuffer.length, filename },
      timestamp: Date.now(),
      hypothesisId: "H1",
    }),
  }).catch(() => {});
  // #endregion

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
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error("[WhatsApp] Media upload failed:", uploadRes.status, err);
    // #region agent log
    fetch("http://127.0.0.1:7244/ingest/88a7285e-a4b7-491f-ab73-2cd80dfe89c9", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8a22f4" },
      body: JSON.stringify({
        sessionId: "8a22f4",
        location: "whatsapp-send.service.ts:uploadFailed",
        message: "Upload failed",
        data: { status: uploadRes.status, err: err.slice(0, 200) },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
    // #endregion
    return false;
  }

  const uploadJson = (await uploadRes.json()) as { id?: string };
  const mediaId = uploadJson.id;
  if (!mediaId) {
    console.error("[WhatsApp] No media ID in upload response:", JSON.stringify(uploadJson));
    return false;
  }

  // #region agent log
  fetch("http://127.0.0.1:7244/ingest/88a7285e-a4b7-491f-ab73-2cd80dfe89c9", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8a22f4" },
    body: JSON.stringify({
      sessionId: "8a22f4",
      location: "whatsapp-send.service.ts:uploadSuccess",
      message: "Upload succeeded",
      data: { mediaId },
      timestamp: Date.now(),
      hypothesisId: "H4",
      runId: "post-fix",
    }),
  }).catch(() => {});
  // #endregion

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
