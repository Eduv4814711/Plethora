"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { AlertBanner, Button } from "@/components/ui";
import type { DocumentVersion, ManagedDocument } from "@/lib/msr-api";
import { regenerateDocument, finalizeDocument, getDocumentVersions } from "@/lib/msr-api";
import { downloadPrivateFile } from "@/lib/api";
import { DocumentToolbar } from "./DocumentToolbar";
import { PdfViewer } from "./PdfViewer";
import { DocumentDetailsPanel } from "./DocumentDetailsPanel";
import { DocumentVersionHistory } from "./DocumentVersionHistory";
import { DocumentEditModal } from "./DocumentEditModal";
import { DocumentMetadataEditor } from "./DocumentMetadataEditor";

export interface DocumentWorkspaceProps {
  document: ManagedDocument;
  token: string;
  initialVersionId?: string;
  onDocumentUpdated?: (doc: ManagedDocument) => void;
}

export function DocumentWorkspace({
  document: initialDoc,
  token,
  initialVersionId,
  onDocumentUpdated,
}: DocumentWorkspaceProps) {
  const [doc, setDoc] = useState<ManagedDocument>(initialDoc);
  const [versions, setVersions] = useState<DocumentVersion[]>(initialDoc.versions || []);
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>(
    initialVersionId || initialDoc.currentVersionId || initialDoc.versions?.[0]?.id
  );

  // Viewer display state
  const [zoom, setZoom] = useState<number>(100);
  const [fitMode, setFitMode] = useState<"custom" | "width" | "page">("width");
  const [rotation, setRotation] = useState<number>(0);

  // Right sidebar tab
  const [sidebarTab, setSidebarTab] = useState<"details" | "versions">("details");

  // Modals state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editModalTab, setEditModalTab] = useState<"rotate" | "reorder" | "delete" | "stamp" | "revision">("rotate");
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);

  // Action states
  const [regenerating, setRegenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; variant: "success" | "error" | "info" } | null>(null);

  // Permissions passed down from API (fallback to sensible defaults)
  const canEdit = doc.permissions?.canEdit ?? true;
  const canExport = doc.permissions?.canExport ?? true;
  const canApprove = doc.permissions?.canApprove ?? false;

  // Selected version details
  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  const latestVersion = versions.length > 0 ? versions[0] : undefined;
  const isViewingHistorical =
    Boolean(selectedVersionId && latestVersion && selectedVersionId !== latestVersion.id);

  // Reload versions when document updates
  const refreshVersions = useCallback(async () => {
    if (!token || !doc.id) return;
    try {
      const data = await getDocumentVersions(token, doc.id);
      if (data?.versions) {
        setVersions(data.versions);
      }
    } catch {
      // Keep existing versions on fail
    }
  }, [token, doc.id]);

  const handleDocumentUpdated = (updated: ManagedDocument) => {
    setDoc(updated);
    if (updated.versions && updated.versions.length > 0) {
      setVersions(updated.versions);
      setSelectedVersionId(updated.currentVersionId || updated.versions[0].id);
    } else {
      refreshVersions();
    }
    setFeedback({
      text: "Document updated and new revision synchronized.",
      variant: "success",
    });
    if (onDocumentUpdated) {
      onDocumentUpdated(updated);
    }
  };

  const handleDownload = async () => {
    try {
      if (selectedVersion) {
        await downloadPrivateFile(
          token,
          `/documents/${doc.id}/versions/${selectedVersion.id}/download`,
          selectedVersion.fileName || doc.fileName
        );
      } else {
        await downloadPrivateFile(
          token,
          `/documents/${doc.id}/download`,
          doc.fileName
        );
      }
      setFeedback({ text: "Download initiated successfully.", variant: "info" });
    } catch (err: any) {
      setFeedback({ text: err?.message || "Failed to download document", variant: "error" });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleRegenerate = async () => {
    if (!token) return;
    setRegenerating(true);
    setFeedback(null);
    try {
      const updated = await regenerateDocument(token, doc.id);
      handleDocumentUpdated(updated);
      setFeedback({
        text: "Document successfully regenerated from current system data as a new version.",
        variant: "success",
      });
    } catch (err: any) {
      setFeedback({
        text: err?.message || "Failed to regenerate document from system data",
        variant: "error",
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleFinalize = async () => {
    if (!token) return;
    setFinalizing(true);
    setFeedback(null);
    try {
      const updated = await finalizeDocument(token, doc.id);
      handleDocumentUpdated(updated);
      setFeedback({
        text: "Document lifecycle transitioned to FINAL.",
        variant: "success",
      });
    } catch (err: any) {
      setFeedback({
        text: err?.message || "Failed to finalize document",
        variant: "error",
      });
    } finally {
      setFinalizing(false);
    }
  };

  const openPdfToolsWithTab = (tab: "rotate" | "reorder" | "delete" | "stamp" | "revision") => {
    setEditModalTab(tab);
    setIsEditModalOpen(true);
  };

  return (
    <div className="flex flex-col h-screen max-h-screen bg-security-navy-50 overflow-hidden">
      {/* Top Breadcrumb Header */}
      <div className="bg-white border-b border-security-navy-200 px-4 py-2 flex items-center justify-between text-xs text-security-navy-600 shrink-0">
        <div className="flex items-center gap-2">
          <Link
            href="/documents"
            className="font-medium text-security-navy-600 hover:text-security-navy-900 transition-colors flex items-center gap-1"
          >
            ← Document Library
          </Link>
          <span className="text-security-navy-300">/</span>
          <span className="font-semibold text-security-navy-900 truncate max-w-md">
            {doc.title}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-security-navy-500">
            Storage: <code className="font-mono text-[11px] text-security-navy-700">{doc.category}</code>
          </span>
          {doc.verificationStatus && (
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                doc.verificationStatus === "VERIFIED"
                  ? "bg-green-100 text-green-800"
                  : doc.verificationStatus === "REJECTED"
                  ? "bg-red-100 text-red-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {doc.verificationStatus}
            </span>
          )}
        </div>
      </div>

      {/* Main Workspace Toolbar */}
      <DocumentToolbar
        document={doc}
        selectedVersionNumber={selectedVersion?.versionNumber}
        totalVersions={versions.length}
        zoom={zoom}
        onZoomChange={setZoom}
        fitMode={fitMode}
        onFitModeChange={setFitMode}
        rotation={rotation}
        onRotateChange={setRotation}
        onDownload={handleDownload}
        onPrint={handlePrint}
        onOpenEditTools={() => openPdfToolsWithTab("rotate")}
        onOpenMetadataEditor={() => setIsMetadataModalOpen(true)}
        onRegenerate={handleRegenerate}
        onFinalize={handleFinalize}
        regenerating={regenerating}
        finalizing={finalizing}
        canEdit={canEdit}
        canExport={canExport}
        canApprove={canApprove}
      />

      {/* Action / Alert Feedback Bar */}
      {feedback && (
        <div className="px-4 py-2 bg-white border-b border-security-navy-100">
          <AlertBanner
            variant={feedback.variant === "success" ? "success" : feedback.variant === "error" ? "error" : "info"}
            className="text-xs py-1.5 px-3 flex items-center justify-between"
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="ml-4 text-security-navy-500 hover:text-security-navy-800 font-bold"
            >
              ✕
            </button>
          </AlertBanner>
        </div>
      )}

      {/* Historical Version Warning Banner */}
      {isViewingHistorical && selectedVersion && latestVersion && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-900 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold">Notice:</span>
            <span>
              You are previewing historical <strong>v{selectedVersion.versionNumber}</strong> created on{" "}
              {new Date(selectedVersion.createdAt).toLocaleDateString()}.
              {selectedVersion.changeSummary ? ` (${selectedVersion.changeSummary})` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedVersionId(latestVersion.id)}
            className="font-semibold underline hover:text-amber-950 ml-2"
          >
            Switch to Current Version (v{latestVersion.versionNumber})
          </button>
        </div>
      )}

      {/* Main Workspace Split Screen */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Document Canvas / Preview Area */}
        <div className="flex-1 min-w-0 bg-security-navy-950/5 relative overflow-hidden flex flex-col">
          <PdfViewer
            documentId={doc.id}
            versionId={selectedVersionId}
            token={token}
            title={doc.title}
            mimeType={selectedVersion?.mimeType || doc.mimeType || "application/pdf"}
            zoom={zoom}
            rotation={rotation}
            fitMode={fitMode}
            className="w-full h-full"
            onError={(msg) => setFeedback({ text: msg, variant: "error" })}
          />
        </div>

        {/* Right: Sidebar Panel */}
        <div className="w-96 border-l border-security-navy-200 bg-white flex flex-col overflow-hidden shrink-0 shadow-sm">
          {/* Sidebar Tab Selector */}
          <div className="flex border-b border-security-navy-200 bg-security-navy-50/50 text-xs font-semibold text-security-navy-700 shrink-0">
            <button
              type="button"
              onClick={() => setSidebarTab("details")}
              className={`flex-1 py-2.5 px-3 text-center border-b-2 transition-colors ${
                sidebarTab === "details"
                  ? "border-security-navy-900 text-security-navy-900 bg-white"
                  : "border-transparent text-security-navy-500 hover:text-security-navy-700"
              }`}
            >
              Document Details
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("versions")}
              className={`flex-1 py-2.5 px-3 text-center border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                sidebarTab === "versions"
                  ? "border-security-navy-900 text-security-navy-900 bg-white"
                  : "border-transparent text-security-navy-500 hover:text-security-navy-700"
              }`}
            >
              <span>Version History</span>
              <span className="rounded-full bg-security-navy-200 text-security-navy-800 text-[10px] px-1.5 py-0.2">
                {versions.length}
              </span>
            </button>
          </div>

          {/* Sidebar Content Area */}
          <div className="flex-1 overflow-y-auto">
            {sidebarTab === "details" && (
              <DocumentDetailsPanel
                document={doc}
                token={token}
                onDocumentUpdated={handleDocumentUpdated}
                canEdit={canEdit}
                canApprove={canApprove}
                onRegenerate={handleRegenerate}
                regenerating={regenerating}
              />
            )}

            {sidebarTab === "versions" && (
              <DocumentVersionHistory
                document={doc}
                versions={versions}
                selectedVersionId={selectedVersionId}
                onSelectVersion={(v) => setSelectedVersionId(v.id)}
                token={token}
                canEdit={canEdit}
                canExport={canExport}
                onUploadRevisionClick={() => openPdfToolsWithTab("revision")}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <DocumentEditModal
        open={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        document={doc}
        token={token}
        onDocumentUpdated={handleDocumentUpdated}
        initialTab={editModalTab}
      />

      <DocumentMetadataEditor
        open={isMetadataModalOpen}
        onClose={() => setIsMetadataModalOpen(false)}
        document={doc}
        token={token}
        onDocumentUpdated={handleDocumentUpdated}
      />
    </div>
  );
}
