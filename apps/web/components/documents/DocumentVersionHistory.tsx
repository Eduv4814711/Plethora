"use client";

import { Badge, Button } from "@/components/ui";
import type { DocumentVersion, ManagedDocument } from "@/lib/msr-api";
import { downloadPrivateFile } from "@/lib/api";

export interface DocumentVersionHistoryProps {
  document: ManagedDocument;
  versions: DocumentVersion[];
  selectedVersionId?: string;
  onSelectVersion: (version: DocumentVersion) => void;
  token: string;
  canEdit?: boolean;
  canExport?: boolean;
  onUploadRevisionClick: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatSourceType(sourceType?: string | null): string {
  if (!sourceType) return "Revision";
  switch (sourceType) {
    case "INITIAL_UPLOAD":
      return "Initial Upload";
    case "MANUAL_REVISION":
      return "Uploaded Revision";
    case "PAGE_ROTATION":
      return "Page Rotation";
    case "PAGE_REORDER":
      return "Page Reorder";
    case "PAGE_DELETION":
      return "Page Deletion";
    case "SIGNATURE_STAMP":
      return "Signature Stamp";
    case "SYSTEM_REGENERATION":
      return "System Regeneration";
    default:
      return sourceType.replace(/_/g, " ");
  }
}

export function DocumentVersionHistory({
  document: doc,
  versions,
  selectedVersionId,
  onSelectVersion,
  token,
  canEdit = false,
  canExport = true,
  onUploadRevisionClick,
}: DocumentVersionHistoryProps) {
  const currentVersionId = doc.currentVersionId || (versions.length > 0 ? versions[0]?.id : undefined);

  const handleDownloadVersion = async (v: DocumentVersion, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token) return;
    const downloadPath = `/documents/${doc.id}/versions/${v.id}/download`;
    await downloadPrivateFile(token, downloadPath, v.fileName);
  };

  return (
    <div className="p-4 space-y-4 text-sm text-security-navy-800">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-security-navy-500">
            Version Timeline ({versions.length})
          </h3>
          <p className="text-xs text-security-navy-500 mt-0.5">
            Every modification produces an immutable version record.
          </p>
        </div>
        {canEdit && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onUploadRevisionClick}
            className="text-xs"
          >
            Upload Revision
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {versions.map((v) => {
          const isCurrent = v.id === currentVersionId;
          const isSelected = v.id === selectedVersionId || (!selectedVersionId && isCurrent);

          return (
            <div
              key={v.id}
              onClick={() => onSelectVersion(v)}
              className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                isSelected
                  ? "border-security-navy-700 bg-security-navy-50/70 shadow-xs ring-1 ring-security-navy-600"
                  : "border-security-navy-200 bg-white hover:border-security-navy-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-security-navy-900 text-sm">
                    Version {v.versionNumber}
                  </span>
                  {isCurrent && (
                    <Badge variant="success" className="text-[10px]">
                      Latest
                    </Badge>
                  )}
                  {isSelected && !isCurrent && (
                    <Badge variant="neutral" className="text-[10px]">
                      Viewing
                    </Badge>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded bg-security-navy-100 text-security-navy-700">
                    {formatSourceType(v.sourceType)}
                  </span>
                </div>
                <span className="text-[11px] text-security-navy-500 shrink-0 font-mono">
                  {formatBytes(v.size)}
                </span>
              </div>

              {v.changeSummary && (
                <p className="text-xs text-security-navy-800 font-medium mt-1.5 leading-relaxed">
                  {v.changeSummary}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-security-navy-100 text-[11px] text-security-navy-500">
                <span>
                  {v.createdBy?.name || "System"} · {new Date(v.createdAt).toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  {canExport && (
                    <button
                      type="button"
                      onClick={(e) => void handleDownloadVersion(v, e)}
                      className="text-security-navy-700 hover:text-security-navy-900 font-medium underline"
                    >
                      Download
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {versions.length === 0 && (
          <div className="p-6 text-center bg-white rounded-lg border border-security-navy-200 text-xs text-security-navy-500">
            No version history recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
