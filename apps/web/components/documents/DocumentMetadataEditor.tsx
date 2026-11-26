"use client";

import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Textarea, AlertBanner } from "@/components/ui";
import type { ManagedDocument } from "@/lib/msr-api";
import { updateDocument } from "@/lib/msr-api";

export interface DocumentMetadataEditorProps {
  open: boolean;
  onClose: () => void;
  document: ManagedDocument;
  token: string;
  onDocumentUpdated: (doc: ManagedDocument) => void;
}

const CATEGORIES = [
  { value: "COMPLIANCE", label: "Compliance & Legal" },
  { value: "EMPLOYEE", label: "Employee & HR" },
  { value: "CLIENT", label: "Client & Contracts" },
  { value: "SITE", label: "Site Operations" },
  { value: "BILLING", label: "Billing & Invoices" },
  { value: "PAYROLL", label: "Payroll & Wages" },
  { value: "ATTENDANCE", label: "Attendance & Timesheets" },
  { value: "INCIDENT", label: "Incident & Evidence" },
  { value: "EQUIPMENT", label: "Equipment & Fleet" },
  { value: "TASK", label: "Tasks & Projects" },
  { value: "REPORT", label: "Reports & Summaries" },
  { value: "ACADEMY", label: "Academy & Certificates" },
  { value: "OTHER", label: "Other / General" },
];

export function DocumentMetadataEditor({
  open,
  onClose,
  document: doc,
  token,
  onDocumentUpdated,
}: DocumentMetadataEditorProps) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category);
  const [documentType, setDocumentType] = useState(doc.documentType);
  const [documentNumber, setDocumentNumber] = useState(doc.documentNumber || "");
  const [issuingAuthority, setIssuingAuthority] = useState(doc.issuingAuthority || "");
  const [issueDate, setIssueDate] = useState(
    doc.issueDate ? doc.issueDate.substring(0, 10) : ""
  );
  const [expiryDate, setExpiryDate] = useState(
    doc.expiryDate ? doc.expiryDate.substring(0, 10) : ""
  );
  const [doesNotExpire, setDoesNotExpire] = useState(Boolean(doc.doesNotExpire));
  const [isSensitive, setIsSensitive] = useState(Boolean(doc.isSensitive));
  const [notes, setNotes] = useState(doc.notes || "");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(doc.title);
      setCategory(doc.category);
      setDocumentType(doc.documentType);
      setDocumentNumber(doc.documentNumber || "");
      setIssuingAuthority(doc.issuingAuthority || "");
      setIssueDate(doc.issueDate ? doc.issueDate.substring(0, 10) : "");
      setExpiryDate(doc.expiryDate ? doc.expiryDate.substring(0, 10) : "");
      setDoesNotExpire(Boolean(doc.doesNotExpire));
      setIsSensitive(Boolean(doc.isSensitive));
      setNotes(doc.notes || "");
      setError(null);
    }
  }, [open, doc]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);

    try {
      const updated = await updateDocument(token, doc.id, {
        title: title.trim(),
        category,
        documentCategory: doc.documentCategory || undefined,
        documentType: documentType.trim(),
        documentNumber: documentNumber.trim() || undefined,
        issuingAuthority: issuingAuthority.trim() || undefined,
        issueDate: issueDate ? issueDate : undefined,
        expiryDate: doesNotExpire ? undefined : expiryDate ? expiryDate : undefined,
        doesNotExpire,
        isSensitive,
        notes: notes.trim() || undefined,
      });

      onDocumentUpdated(updated);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to update document metadata");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !loading && onClose()}
      title="Edit Document Properties"
      description="Update categorization, dates, and compliance metadata."
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {error && (
            <AlertBanner variant="error" className="mb-3">
              {error}
            </AlertBanner>
          )}

          <div>
            <label className="block font-semibold text-security-navy-700 mb-1">
              Document Title *
            </label>
            <Input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. PSIRA Officer Certificate"
              className="w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-security-navy-700 mb-1">
                Category *
              </label>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block font-semibold text-security-navy-700 mb-1">
                Document Type *
              </label>
              <Input
                required
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="e.g. ID_CARD, CONTRACT"
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-security-navy-700 mb-1">
                Reference / Document Number
              </label>
              <Input
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="e.g. PSIRA-99824"
                className="w-full"
              />
            </div>

            <div>
              <label className="block font-semibold text-security-navy-700 mb-1">
                Issuing Authority
              </label>
              <Input
                value={issuingAuthority}
                onChange={(e) => setIssuingAuthority(e.target.value)}
                placeholder="e.g. PSIRA, Department of Home Affairs"
                className="w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-security-navy-700 mb-1">
                Issue Date
              </label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full"
              />
            </div>

            <div>
              <label className="block font-semibold text-security-navy-700 mb-1">
                Expiry Date
              </label>
              <Input
                type="date"
                disabled={doesNotExpire}
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-security-navy-700">
              <input
                type="checkbox"
                checked={doesNotExpire}
                onChange={(e) => setDoesNotExpire(e.target.checked)}
                className="rounded text-security-navy-900 focus:ring-security-navy-500"
              />
              Document does not expire
            </label>

            <label className="flex items-center gap-2 cursor-pointer font-medium text-security-navy-700">
              <input
                type="checkbox"
                checked={isSensitive}
                onChange={(e) => setIsSensitive(e.target.checked)}
                className="rounded text-security-navy-900 focus:ring-security-navy-500"
              />
              Sensitive Document (Restricted access permissions required)
            </label>
          </div>

          <div>
            <label className="block font-semibold text-security-navy-700 mb-1">
              Internal Notes
            </label>
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any internal administrative notes or context..."
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-security-navy-100 pt-3">
            <Button variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={loading}>
              Save Changes
            </Button>
          </div>
        </form>
    </Modal>
  );
}
