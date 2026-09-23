"use client";

import { Badge, Button } from "@/components/ui";
import type { ManagedDocument } from "@/lib/msr-api";

export interface DocumentToolbarProps {
  document: ManagedDocument;
  selectedVersionNumber?: number;
  totalVersions?: number;
  zoom: number;
  onZoomChange: (z: number) => void;
  fitMode: "custom" | "width" | "page";
  onFitModeChange: (f: "custom" | "width" | "page") => void;
  rotation: number;
  onRotateChange: (r: number) => void;
  onDownload: () => void;
  onPrint: () => void;
  onOpenEditTools: () => void;
  onOpenMetadataEditor: () => void;
  onRegenerate?: () => void;
  onFinalize?: () => void;
  regenerating?: boolean;
  finalizing?: boolean;
  canEdit?: boolean;
  canExport?: boolean;
  canApprove?: boolean;
}

export function DocumentToolbar({
  document: doc,
  selectedVersionNumber,
  totalVersions = 1,
  zoom,
  onZoomChange,
  fitMode,
  onFitModeChange,
  rotation,
  onRotateChange,
  onDownload,
  onPrint,
  onOpenEditTools,
  onOpenMetadataEditor,
  onRegenerate,
  onFinalize,
  regenerating = false,
  finalizing = false,
  canEdit = false,
  canExport = true,
  canApprove = false,
}: DocumentToolbarProps) {
  const isPdf = doc.fileName.toLowerCase().endsWith(".pdf") || doc.mimeType === "application/pdf";
  const isGenerated = doc.origin === "GENERATED";
  const isDraftOrReview = doc.lifecycleStatus === "DRAFT" || doc.lifecycleStatus === "REVIEW";

  const handleZoomIn = () => {
    onFitModeChange("custom");
    onZoomChange(Math.min(250, zoom + 15));
  };

  const handleZoomOut = () => {
    onFitModeChange("custom");
    onZoomChange(Math.max(50, zoom - 15));
  };

  const handleRotateLeft = () => {
    onRotateChange((rotation - 90 + 360) % 360);
  };

  const handleRotateRight = () => {
    onRotateChange((rotation + 90) % 360);
  };

  return (
    <div className="bg-white border-b border-security-navy-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-10 shadow-xs">
      {/* Document info & badges */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-security-navy-900 truncate">
              {doc.title}
            </h1>
            <Badge variant={isGenerated ? "warning" : "neutral"}>
              {isGenerated ? "System Generated" : "Uploaded File"}
            </Badge>
            {doc.lifecycleStatus && (
              <Badge variant={doc.lifecycleStatus === "FINAL" ? "success" : "neutral"}>
                {doc.lifecycleStatus}
              </Badge>
            )}
            {selectedVersionNumber && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-security-navy-100 text-security-navy-700">
                v{selectedVersionNumber}
                {totalVersions > 1 ? ` of ${totalVersions}` : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-security-navy-500 truncate mt-0.5">
            {doc.fileName} · {doc.documentType} · {doc.category.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Control Actions & Toolbar Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Zoom Controls */}
        <div className="flex items-center rounded-md border border-security-navy-200 bg-security-navy-50/50 p-0.5 text-xs">
          <button
            type="button"
            onClick={handleZoomOut}
            className="px-2 py-1 hover:bg-white rounded text-security-navy-700 disabled:opacity-40"
            title="Zoom Out"
            disabled={zoom <= 50}
          >
            -
          </button>
          <span className="px-2 text-security-navy-800 font-mono font-medium">
            {fitMode === "width" ? "Fit W" : fitMode === "page" ? "Fit P" : `${zoom}%`}
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            className="px-2 py-1 hover:bg-white rounded text-security-navy-700 disabled:opacity-40"
            title="Zoom In"
            disabled={zoom >= 250}
          >
            +
          </button>
          <div className="w-[1px] h-4 bg-security-navy-300 mx-1" />
          <button
            type="button"
            onClick={() => onFitModeChange("width")}
            className={`px-2 py-1 rounded text-xs ${fitMode === "width" ? "bg-white font-semibold text-security-navy-900 shadow-xs" : "text-security-navy-600 hover:bg-white"}`}
          >
            Fit Width
          </button>
          <button
            type="button"
            onClick={() => {
              onFitModeChange("custom");
              onZoomChange(100);
            }}
            className={`px-2 py-1 rounded text-xs ${fitMode === "custom" && zoom === 100 ? "bg-white font-semibold text-security-navy-900 shadow-xs" : "text-security-navy-600 hover:bg-white"}`}
          >
            100%
          </button>
        </div>

        {/* Rotation */}
        <div className="flex items-center rounded-md border border-security-navy-200 bg-security-navy-50/50 p-0.5 text-xs">
          <button
            type="button"
            onClick={handleRotateLeft}
            className="px-2 py-1 hover:bg-white rounded text-security-navy-700"
            title="Rotate Left (90° Counter-Clockwise)"
          >
            ↺
          </button>
          <button
            type="button"
            onClick={handleRotateRight}
            className="px-2 py-1 hover:bg-white rounded text-security-navy-700"
            title="Rotate Right (90° Clockwise)"
          >
            ↻
          </button>
        </div>

        {/* Print & Download */}
        <Button variant="secondary" size="sm" onClick={onPrint} title="Print Document">
          Print
        </Button>

        {canExport && (
          <Button variant="secondary" size="sm" onClick={onDownload} title="Download File">
            Download
          </Button>
        )}

        {/* Finalize button (if in Draft or Review) */}
        {isDraftOrReview && canApprove && onFinalize && (
          <Button
            variant="primary"
            size="sm"
            onClick={onFinalize}
            loading={finalizing}
            title="Finalize this document"
          >
            Finalize
          </Button>
        )}

        {/* Regenerate (if system generated) */}
        {isGenerated && canEdit && onRegenerate && (
          <Button
            variant="amber"
            size="sm"
            onClick={onRegenerate}
            loading={regenerating}
            title="Re-render PDF from latest database records"
          >
            Regenerate
          </Button>
        )}

        {/* PDF Edit Tools (if uploaded PDF) */}
        {!isGenerated && isPdf && canEdit && (
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenEditTools}
            title="Rotate, reorder, delete pages or add signature stamp"
          >
            PDF Tools
          </Button>
        )}

        {/* Metadata Editor */}
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenMetadataEditor}
            title="Edit document properties"
          >
            Details
          </Button>
        )}
      </div>
    </div>
  );
}
