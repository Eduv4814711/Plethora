import { buildApiUrl } from "./api";

/** Strip illegal filename and path characters so OS file systems don't reject downloads. */
export function sanitizeDownloadFilename(filename: string): string {
  return filename
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/** Streams a file attachment to the browser, honouring the server's Content-Disposition filename. */
export async function downloadAttachment(
  token: string,
  path: string,
  fallbackName: string
): Promise<void> {
  const safeFallback = sanitizeDownloadFilename(fallbackName) || "document.pdf";
  const res = await fetch(buildApiUrl(path.replace(/^\//, "")), {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    const statusInfo = res.status ? ` (${res.status}${res.statusText ? ` ${res.statusText}` : ""})` : "";
    const msg = err.message || err.error;
    throw new Error(msg ? `${msg}${statusInfo ? ` [${res.status}]` : ""}` : `Failed to download ${safeFallback}${statusInfo}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  const utf8Match = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
  const regularMatch = disposition?.match(/filename="?([^";]+)"?/i);
  let resolvedFilename = safeFallback;
  if (utf8Match?.[1]) {
    try {
      resolvedFilename = sanitizeDownloadFilename(decodeURIComponent(utf8Match[1]));
    } catch {}
  } else if (regularMatch?.[1]) {
    resolvedFilename = sanitizeDownloadFilename(regularMatch[1]);
  }

  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = resolvedFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Defer revocation so Chromium / browser download managers finish reading the blob
  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
}

/** Fetches a PDF or document and displays it in a new browser tab for preview. */
export async function previewAttachment(
  token: string,
  path: string
): Promise<void> {
  const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
  if (win) {
    win.document.title = "Loading document preview...";
    win.document.body.innerHTML = `
      <div style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #334155; background: #f8fafc;">
        <div style="text-align: center;">
          <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Rendering document...</div>
          <div style="font-size: 13px; color: #64748b;">Plethora Billing System</div>
        </div>
      </div>
    `;
  }

  try {
    const res = await fetch(buildApiUrl(path.replace(/^\//, "")), {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      const statusInfo = res.status ? ` (${res.status}${res.statusText ? ` ${res.statusText}` : ""})` : "";
      const msg = err.message || err.error;
      const message = msg ? `${msg}${statusInfo ? ` [${res.status}]` : ""}` : `Failed to preview document${statusInfo}`;
      if (win) {
        win.document.body.innerHTML = `<div style="padding: 24px; color: #b91c1c; font-family: system-ui;">${message}</div>`;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    if (win) {
      win.location.href = blobUrl;
    } else if (typeof window !== "undefined") {
      window.open(blobUrl, "_blank");
    }
  } catch (err) {
    if (win && !win.closed) {
      win.close();
    }
    throw err;
  }
}

