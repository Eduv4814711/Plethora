import { buildApiUrl } from "./api";

/** Streams a file attachment to the browser, honouring the server's Content-Disposition filename. */
export async function downloadAttachment(
  token: string,
  path: string,
  fallbackName: string
): Promise<void> {
  const res = await fetch(buildApiUrl(path.replace(/^\//, "")), {
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message || `Failed to download ${fallbackName}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition");
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] ?? fallbackName;
  a.click();
  URL.revokeObjectURL(a.href);
}
