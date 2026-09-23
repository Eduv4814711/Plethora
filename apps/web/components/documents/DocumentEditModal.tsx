"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select, Textarea, AlertBanner } from "@/components/ui";
import type { ManagedDocument } from "@/lib/msr-api";
import {
  rotateDocumentPages,
  reorderDocumentPages,
  deleteDocumentPages,
  stampDocument,
  uploadDocumentVersion,
} from "@/lib/msr-api";

export interface DocumentEditModalProps {
  open: boolean;
  onClose: () => void;
  document: ManagedDocument;
  token: string;
  onDocumentUpdated: (doc: ManagedDocument) => void;
  initialTab?: "rotate" | "reorder" | "delete" | "stamp" | "revision";
}

type TabType = "rotate" | "reorder" | "delete" | "stamp" | "revision";

export function DocumentEditModal({
  open,
  onClose,
  document: doc,
  token,
  onDocumentUpdated,
  initialTab = "rotate",
}: DocumentEditModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rotation state
  const [rotateAngle, setRotateAngle] = useState<number>(90);
  const [rotateMode, setRotateMode] = useState<"all" | "custom">("all");
  const [rotatePagesInput, setRotatePagesInput] = useState<string>("");

  // Reorder state
  const [reorderInput, setReorderInput] = useState<string>("");

  // Delete state
  const [deletePagesInput, setDeletePagesInput] = useState<string>("");

  // Stamp state
  const [signerRole, setSignerRole] = useState<string>("Operations Officer");
  const [stampNotes, setStampNotes] = useState<string>("Verified and approved for operations");
  const [stampPage, setStampPage] = useState<"last" | "first">("last");
  const [stampPlacement, setStampPlacement] = useState<"bottom-right" | "bottom-left" | "top-right">("bottom-right");

  // Revision upload state
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [changeSummary, setChangeSummary] = useState<string>("");

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setError(null);
      setLoading(false);
    }
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onClose]);

  if (!open) return null;

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);

    try {
      let pageIndices: number[] | undefined = undefined;
      if (rotateMode === "custom") {
        const parsed = rotatePagesInput
          .split(",")
          .map((s) => parseInt(s.trim(), 10) - 1)
          .filter((n) => !isNaN(n) && n >= 0);
        if (parsed.length === 0) {
          throw new Error("Please specify valid page numbers to rotate (e.g. 1, 2)");
        }
        pageIndices = parsed;
      }

      const updated = await rotateDocumentPages(token, doc.id, {
        angleDegrees: rotateAngle,
        pageIndices,
      });
      onDocumentUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to rotate pages");
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);

    try {
      const parsed = reorderInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((n) => !isNaN(n) && n >= 0);

      if (parsed.length === 0) {
        throw new Error("Please provide the page order sequence (e.g. 2, 1, 3)");
      }

      const updated = await reorderDocumentPages(token, doc.id, parsed);
      onDocumentUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to reorder pages");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePages = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);

    try {
      const parsed = deletePagesInput
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((n) => !isNaN(n) && n >= 0);

      if (parsed.length === 0) {
        throw new Error("Please enter at least one page number to delete (e.g. 3, 5)");
      }

      const updated = await deleteDocumentPages(token, doc.id, parsed);
      onDocumentUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to delete pages");
    } finally {
      setLoading(false);
    }
  };

  const handleStamp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);

    try {
      // Placement coordinates
      let x = 380;
      let y = 40;
      if (stampPlacement === "bottom-left") {
        x = 40;
        y = 40;
      } else if (stampPlacement === "top-right") {
        x = 380;
        y = 700;
      }

      const updated = await stampDocument(token, doc.id, {
        signerRole: signerRole.trim() || undefined,
        notes: stampNotes.trim() || undefined,
        pageIndex: stampPage === "first" ? 0 : undefined,
        x,
        y,
      });
      onDocumentUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to apply electronic signature stamp");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !revisionFile) {
      setError("Please select a file to upload");
      return;
    }
    setError(null);
    setLoading(true);

    try {
      const updated = await uploadDocumentVersion(
        token,
        doc.id,
        revisionFile,
        changeSummary.trim() || undefined
      );
      onDocumentUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to upload revision");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex animate-fade-in items-center justify-center bg-security-navy-900/50 p-4 backdrop-blur-[3px]"
      role="presentation"
    >
      <div
        className="w-full max-w-xl animate-slide-up rounded-security-lg border border-security-navy-200 bg-white p-6 shadow-security-elevated motion-reduce:animate-none flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-tools-modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-security-navy-100 pb-3">
          <div>
            <h2 id="pdf-tools-modal-title" className="text-lg font-bold text-security-navy-900">
              PDF Workspace Tools
            </h2>
            <p className="text-xs text-security-navy-500 mt-0.5">
              Modify uploaded PDF documents safely. All actions generate an immutable version.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-security-navy-400 hover:text-security-navy-700 p-1 rounded text-base leading-none"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Tab Strip */}
        <div className="flex border-b border-security-navy-200 mt-3 gap-1 overflow-x-auto text-xs font-medium">
          <button
            type="button"
            onClick={() => { setActiveTab("rotate"); setError(null); }}
            className={`px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "rotate"
                ? "border-security-navy-900 text-security-navy-900 font-semibold"
                : "border-transparent text-security-navy-500 hover:text-security-navy-700"
            }`}
          >
            Rotate Pages
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("reorder"); setError(null); }}
            className={`px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "reorder"
                ? "border-security-navy-900 text-security-navy-900 font-semibold"
                : "border-transparent text-security-navy-500 hover:text-security-navy-700"
            }`}
          >
            Reorder Pages
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("delete"); setError(null); }}
            className={`px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "delete"
                ? "border-security-navy-900 text-security-navy-900 font-semibold"
                : "border-transparent text-security-navy-500 hover:text-security-navy-700"
            }`}
          >
            Delete Pages
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("stamp"); setError(null); }}
            className={`px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "stamp"
                ? "border-security-navy-900 text-security-navy-900 font-semibold"
                : "border-transparent text-security-navy-500 hover:text-security-navy-700"
            }`}
          >
            Signature Stamp
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("revision"); setError(null); }}
            className={`px-3 py-2 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === "revision"
                ? "border-security-navy-900 text-security-navy-900 font-semibold"
                : "border-transparent text-security-navy-500 hover:text-security-navy-700"
            }`}
          >
            Upload Revision
          </button>
        </div>

        {/* Modal Body */}
        <div className="py-4 overflow-y-auto flex-1 text-sm space-y-4">
          {error && (
            <AlertBanner variant="error" className="mb-3">
              {error}
            </AlertBanner>
          )}

          {/* TAB 1: ROTATE */}
          {activeTab === "rotate" && (
            <form id="rotate-form" onSubmit={handleRotate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Rotation Angle
                </label>
                <Select
                  value={rotateAngle}
                  onChange={(e) => setRotateAngle(parseInt(e.target.value, 10))}
                  className="w-full"
                >
                  <option value={90}>90° Clockwise</option>
                  <option value={180}>180° Half Turn</option>
                  <option value={270}>270° Counter-Clockwise</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Target Pages
                </label>
                <div className="flex items-center gap-4 text-xs mb-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="rotateMode"
                      checked={rotateMode === "all"}
                      onChange={() => setRotateMode("all")}
                      className="text-security-navy-900 focus:ring-security-navy-500"
                    />
                    All Pages
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="rotateMode"
                      checked={rotateMode === "custom"}
                      onChange={() => setRotateMode("custom")}
                      className="text-security-navy-900 focus:ring-security-navy-500"
                    />
                    Specific Pages
                  </label>
                </div>

                {rotateMode === "custom" && (
                  <Input
                    placeholder="e.g. 1, 3, 5"
                    value={rotatePagesInput}
                    onChange={(e) => setRotatePagesInput(e.target.value)}
                    className="w-full"
                  />
                )}
                <p className="text-xs text-security-navy-500 mt-1">
                  {rotateMode === "all"
                    ? "Rotates every page in the PDF document."
                    : "Comma-separated list of 1-based page numbers to rotate."}
                </p>
              </div>

              <div className="rounded-security bg-security-navy-50/70 p-3 text-xs text-security-navy-600 border border-security-navy-100">
                Rotating pages creates a new document version preserving historical revisions.
              </div>
            </form>
          )}

          {/* TAB 2: REORDER */}
          {activeTab === "reorder" && (
            <form id="reorder-form" onSubmit={handleReorder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  New Page Sequence
                </label>
                <Input
                  placeholder="e.g. 3, 1, 2, 4"
                  value={reorderInput}
                  onChange={(e) => setReorderInput(e.target.value)}
                  className="w-full font-mono text-sm"
                />
                <p className="text-xs text-security-navy-500 mt-1.5">
                  Enter 1-based page numbers in their desired order, separated by commas.
                  All existing pages must be included in the sequence.
                </p>
              </div>

              <div className="rounded-security bg-security-navy-50/70 p-3 text-xs text-security-navy-600 border border-security-navy-100">
                Example: For a 3-page document, entering <code className="font-mono bg-white px-1 py-0.5 rounded border">2, 3, 1</code> makes page 2 first, page 3 second, and page 1 last.
              </div>
            </form>
          )}

          {/* TAB 3: DELETE */}
          {activeTab === "delete" && (
            <form id="delete-form" onSubmit={handleDeletePages} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Page Numbers to Delete
                </label>
                <Input
                  placeholder="e.g. 2, 4"
                  value={deletePagesInput}
                  onChange={(e) => setDeletePagesInput(e.target.value)}
                  className="w-full font-mono text-sm"
                />
                <p className="text-xs text-security-navy-500 mt-1.5">
                  Specify 1-based page numbers to remove, separated by commas.
                </p>
              </div>

              <div className="rounded-security bg-red-50/60 p-3 text-xs text-red-700 border border-red-200">
                <span className="font-semibold">Note:</span> You cannot delete all pages. The resulting document will be saved as a new version, so the previous pages remain accessible in the version history.
              </div>
            </form>
          )}

          {/* TAB 4: STAMP */}
          {activeTab === "stamp" && (
            <form id="stamp-form" onSubmit={handleStamp} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Signer Title / Role
                </label>
                <Input
                  value={signerRole}
                  onChange={(e) => setSignerRole(e.target.value)}
                  placeholder="e.g. Operations Manager, PSIRA Compliance Officer"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Verification / Endorsement Notes
                </label>
                <Input
                  value={stampNotes}
                  onChange={(e) => setStampNotes(e.target.value)}
                  placeholder="e.g. Verified against original documentation"
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                    Target Page
                  </label>
                  <Select
                    value={stampPage}
                    onChange={(e) => setStampPage(e.target.value as "last" | "first")}
                    className="w-full"
                  >
                    <option value="last">Last Page</option>
                    <option value="first">First Page</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                    Stamp Placement
                  </label>
                  <Select
                    value={stampPlacement}
                    onChange={(e) => setStampPlacement(e.target.value as any)}
                    className="w-full"
                  >
                    <option value="bottom-right">Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="top-right">Top Right</option>
                  </Select>
                </div>
              </div>

              <div className="rounded-security bg-security-navy-50/70 p-3 text-xs text-security-navy-600 border border-security-navy-100">
                The stamp includes your authenticated user name, company name, date/time, role, and verification note in a tamper-evident audit block.
              </div>
            </form>
          )}

          {/* TAB 5: UPLOAD REVISION */}
          {activeTab === "revision" && (
            <form id="revision-form" onSubmit={handleUploadRevision} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Replacement / Revision File
                </label>
                <input
                  type="file"
                  onChange={(e) => setRevisionFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-security-navy-700 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-security-navy-100 file:text-security-navy-800 hover:file:bg-security-navy-200 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-security-navy-700 mb-1">
                  Change Summary / Revision Reason
                </label>
                <Textarea
                  rows={3}
                  value={changeSummary}
                  onChange={(e) => setChangeSummary(e.target.value)}
                  placeholder="e.g. Uploaded newly signed and witnessed contract scan"
                  className="w-full"
                />
              </div>

              <div className="rounded-security bg-security-navy-50/70 p-3 text-xs text-security-navy-600 border border-security-navy-100">
                This will save the selected file as the new active version of this document record while keeping previous revisions in history.
              </div>
            </form>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-security-navy-100 pt-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>

          {activeTab === "rotate" && (
            <Button
              variant="primary"
              loading={loading}
              onClick={handleRotate}
            >
              Rotate & Create Version
            </Button>
          )}

          {activeTab === "reorder" && (
            <Button
              variant="primary"
              loading={loading}
              onClick={handleReorder}
            >
              Reorder & Create Version
            </Button>
          )}

          {activeTab === "delete" && (
            <Button
              variant="destructive"
              loading={loading}
              onClick={handleDeletePages}
            >
              Delete Pages & Create Version
            </Button>
          )}

          {activeTab === "stamp" && (
            <Button
              variant="primary"
              loading={loading}
              onClick={handleStamp}
            >
              Apply Stamp & Create Version
            </Button>
          )}

          {activeTab === "revision" && (
            <Button
              variant="primary"
              loading={loading}
              onClick={handleUploadRevision}
              disabled={!revisionFile}
            >
              Upload Revision
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
