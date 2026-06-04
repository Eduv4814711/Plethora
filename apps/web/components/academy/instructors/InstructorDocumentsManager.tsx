"use client";

import { useState } from "react";
import type { InstructorDocument } from "./types";
import { DateInput } from "@/components/date-input";
import { buildApiUrl } from "@/lib/api";

const DOCUMENT_TYPES = [
  { value: "instructor_certificate", label: "Instructor Certificate" },
  { value: "employment_contract", label: "Employment Contract" },
  { value: "confirmation_letter", label: "Confirmation Letter" },
  { value: "id_copy", label: "ID Copy" },
  { value: "qualification_proof", label: "Qualification Proof" },
  { value: "other", label: "Other Supporting Document" },
];

function statusTone(status: string): string {
  if (status === "verified") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "pending_review") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "expired") return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function statusLabel(status: string): string {
  if (status === "verified") return "Verified";
  if (status === "pending_review") return "Pending Review";
  if (status === "expired") return "Expired";
  return "Missing";
}

function fileHref(fileUrl: string): string {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const path = fileUrl.startsWith("/uploads/")
    ? fileUrl.slice("/uploads/".length)
    : fileUrl.replace(/^\/+/, "");
  return buildApiUrl(`/uploads/${path}`);
}

export function InstructorDocumentsManager({
  documents,
  canEdit,
  uploading,
  onUpload,
  onReplace,
  onDelete,
  onMarkVerified,
}: {
  documents: InstructorDocument[];
  canEdit: boolean;
  uploading?: boolean;
  onUpload: (payload: {
    file: File;
    documentType: string;
    issueDate?: string;
    expiryDate?: string;
    notes?: string;
  }) => Promise<void>;
  onReplace: (document: InstructorDocument, file: File) => Promise<void>;
  onDelete: (documentId: string) => Promise<void>;
  onMarkVerified: (documentId: string) => Promise<void>;
}) {
  const [documentType, setDocumentType] = useState("instructor_certificate");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const upload = async () => {
    if (!file) return;
    await onUpload({
      file,
      documentType,
      issueDate: issueDate || undefined,
      expiryDate: expiryDate || undefined,
      notes: notes || undefined,
    });
    setFile(null);
    setIssueDate("");
    setExpiryDate("");
    setNotes("");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Document Type</span>
            <select
              className="input-modern w-full rounded-xl"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              disabled={!canEdit || uploading}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Issue Date</span>
            <DateInput
              value={issueDate}
              onChange={setIssueDate}
              className="input-modern"
              disabled={!canEdit || uploading}
              ariaLabel="Document issue date"
              showToday
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Expiry Date</span>
            <DateInput
              value={expiryDate}
              onChange={setExpiryDate}
              className="input-modern"
              disabled={!canEdit || uploading}
              ariaLabel="Document expiry date"
              showToday
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">File</span>
            <input
              type="file"
              className="block w-full rounded-security border-2 border-neutral-300 bg-white text-sm text-neutral-700 file:mr-3 file:rounded-security file:border-0 file:bg-security-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-security-navy-800"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={!canEdit || uploading}
            />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Notes</span>
          <textarea
            className="input-modern w-full rounded-xl"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!canEdit || uploading}
            placeholder="Verification context, document comments, exceptions..."
          />
        </label>
        <div className="mt-3">
          <button
            type="button"
            className="btn-primary px-3 py-1.5 text-xs rounded-xl"
            disabled={!canEdit || uploading || !file}
            onClick={upload}
          >
            {uploading ? "Uploading..." : "Upload Document"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-neutral-200 text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-neutral-500">
              <th>File Name</th>
              <th>Type</th>
              <th>Upload Date</th>
              <th>Expiry Date</th>
              <th>Verification Status</th>
              <th>Uploaded By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-neutral-500">
                  No supporting documents uploaded yet.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="max-w-[240px] truncate">{doc.fileName}</td>
                  <td className="text-xs">
                    {DOCUMENT_TYPES.find((option) => option.value === doc.documentType)?.label ?? doc.documentType}
                  </td>
                  <td>{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "—"}</td>
                  <td>{doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString() : "—"}</td>
                  <td>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusTone(doc.verificationStatus)}`}
                    >
                      {statusLabel(doc.verificationStatus)}
                    </span>
                  </td>
                  <td>{doc.uploadedBy?.name || doc.uploadedBy?.email || "—"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <a
                        href={fileHref(doc.fileUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost px-2 py-1 text-xs rounded-lg"
                      >
                        Preview
                      </a>
                      <a href={fileHref(doc.fileUrl)} download className="btn-ghost px-2 py-1 text-xs rounded-lg">
                        Download
                      </a>
                      {canEdit && (
                        <label className="btn-ghost px-2 py-1 text-xs rounded-lg">
                          Replace
                          <input
                            type="file"
                            className="hidden"
                            onChange={async (e) => {
                              const next = e.target.files?.[0];
                              if (!next) return;
                              await onReplace(doc, next);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      )}
                      {canEdit && doc.verificationStatus !== "verified" && (
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs rounded-lg"
                          onClick={() => onMarkVerified(doc.id)}
                        >
                          Mark Verified
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" className="btn-ghost px-2 py-1 text-xs rounded-lg text-red-600" onClick={() => onDelete(doc.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { DOCUMENT_TYPES };
