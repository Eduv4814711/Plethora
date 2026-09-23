"use client";

import { useEffect, useState, useRef } from "react";
import { buildApiUrl } from "@/lib/api";
import { Spinner, AlertBanner } from "@/components/ui";

export interface PdfViewerProps {
  documentId: string;
  versionId?: string;
  token: string;
  title: string;
  mimeType: string;
  zoom?: number; // percentage (e.g. 100)
  rotation?: number; // 0, 90, 180, 270
  fitMode?: "custom" | "width" | "page";
  className?: string;
  onError?: (msg: string) => void;
}

export function PdfViewer({
  documentId,
  versionId,
  token,
  title,
  mimeType,
  zoom = 100,
  rotation = 0,
  fitMode = "custom",
  className = "",
  onError,
}: PdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    async function loadFile() {
      if (!token || !documentId) return;
      setLoading(true);
      setError(null);
      setTextContent(null);

      try {
        const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
        const url = buildApiUrl(`documents/${documentId}/file${query}`);
        const res = await fetch(url, {
          credentials: "include",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to load document (${res.status})`);
        }

        const blob = await res.blob();
        if (!active) return;

        if (mimeType.startsWith("text/") || mimeType === "text/csv") {
          const text = await blob.text();
          if (active) setTextContent(text);
        } else {
          createdUrl = URL.createObjectURL(blob);
          if (active) setBlobUrl(createdUrl);
        }
      } catch (err: any) {
        if (!active) return;
        const msg = err?.message || "Unable to load document file.";
        setError(msg);
        onError?.(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFile();

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [documentId, versionId, token, mimeType, onError]);

  if (loading) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[500px] bg-security-navy-50/50 rounded-lg border border-security-navy-200 ${className}`}>
        <Spinner className="w-8 h-8 text-security-navy-600 mb-3" />
        <p className="text-sm font-medium text-security-navy-700">Loading document preview…</p>
        <p className="text-xs text-security-navy-500 mt-1">{title}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-6 min-h-[400px] flex flex-col items-center justify-center bg-white rounded-lg border border-security-navy-200 ${className}`}>
        <div className="max-w-md w-full">
          <AlertBanner variant="error" title="Document preview unavailable">
            {error}
          </AlertBanner>
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-secondary text-xs"
            >
              Try reloading
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Text/CSV Viewer
  if (textContent !== null) {
    return (
      <div
        ref={containerRef}
        className={`bg-white rounded-lg border border-security-navy-200 overflow-auto p-4 ${className}`}
        style={{ minHeight: "550px", maxHeight: "80vh" }}
      >
        <pre className="font-mono text-xs text-security-navy-900 whitespace-pre-wrap leading-relaxed">
          {textContent}
        </pre>
      </div>
    );
  }

  // Image Viewer
  const isImage = mimeType.startsWith("image/");
  if (isImage && blobUrl) {
    const scale = fitMode === "width" ? 1 : fitMode === "page" ? 0.8 : zoom / 100;
    return (
      <div
        ref={containerRef}
        className={`bg-security-navy-900/5 rounded-lg border border-security-navy-200 overflow-auto flex items-center justify-center p-6 ${className}`}
        style={{ minHeight: "550px", maxHeight: "80vh" }}
      >
        <img
          src={blobUrl}
          alt={title}
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            transition: "transform 0.15s ease-out",
            maxWidth: fitMode === "width" ? "100%" : undefined,
            maxHeight: fitMode === "page" ? "100%" : undefined,
          }}
          className="rounded shadow-md object-contain"
        />
      </div>
    );
  }

  // PDF Viewer
  if (blobUrl) {
    // Zoom transform container for PDF iframe
    const scale = fitMode === "width" ? 1 : fitMode === "page" ? 0.9 : zoom / 100;
    const isScaled = scale !== 1 || rotation !== 0;

    return (
      <div
        ref={containerRef}
        className={`relative w-full bg-security-navy-900/10 rounded-lg border border-security-navy-200 overflow-auto flex justify-center ${className}`}
        style={{ height: "76vh", minHeight: "580px" }}
      >
        <div
          style={{
            width: fitMode === "width" ? "100%" : isScaled ? `${Math.max(100, Math.round(100 * scale))}%` : "100%",
            height: isScaled ? `${Math.max(100, Math.round(100 * scale))}%` : "100%",
            transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
            transformOrigin: "center center",
            transition: "all 0.15s ease-out",
          }}
          className="w-full h-full"
        >
          <iframe
            src={`${blobUrl}#toolbar=0&navpanes=0`}
            title={title}
            className="w-full h-full rounded border-0 shadow-sm bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`p-8 text-center bg-white rounded-lg border border-security-navy-200 ${className}`}>
      <p className="text-sm text-security-navy-600">No preview available for this document.</p>
    </div>
  );
}
