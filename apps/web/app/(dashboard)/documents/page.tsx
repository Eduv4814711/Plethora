"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  listDocuments,
  uploadDocument,
  archiveDocument,
  type ManagedDocument,
} from "@/lib/msr-api";
import { authFetch, downloadPrivateFile } from "@/lib/api";
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";

const CATEGORIES = [
  { value: "", label: "All Categories" },
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

const ORIGINS = [
  { value: "", label: "All Origins" },
  { value: "UPLOADED", label: "Uploaded Files" },
  { value: "GENERATED", label: "System Generated" },
];

const LIFECYCLE_STATUSES = [
  { value: "", label: "All Lifecycles" },
  { value: "DRAFT", label: "Draft" },
  { value: "REVIEW", label: "Review" },
  { value: "FINAL", label: "Final" },
  { value: "SUPERSEDED", label: "Superseded" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function DocumentsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/documents", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/documents", "edit"));
  const canExport = Boolean(user && hasCapability(user, "/documents", "export"));

  const [items, setItems] = useState<ManagedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [expiryDate, setExpiryDate] = useState("");
  const [doesNotExpire, setDoesNotExpire] = useState(false);
  const [isSensitive, setIsSensitive] = useState(false);
  const [siteId, setSiteId] = useState("");
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!token) return;
    authFetch("/sites?limit=200", token)
      .then((r) => r.json())
      .then((d) =>
        setSites(
          (d.data ?? []).map((s: { id: string; name: string }) => ({
            id: s.id,
            name: s.name,
          }))
        )
      )
      .catch(() => setSites([]));
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const result = await listDocuments(token, {
        search: searchTerm.trim() || undefined,
        category: categoryFilter || undefined,
        origin: originFilter || undefined,
        lifecycleStatus: lifecycleFilter || undefined,
        limit: 100,
      });
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load documents");
      setItems([]);
    }
  }, [token, searchTerm, categoryFilter, originFilter, lifecycleFilter]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [token, refresh]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canCreate || !file || !title.trim() || !documentType.trim()) return;
    setUploading(true);
    setError("");
    try {
      await uploadDocument(token, file, {
        title: title.trim(),
        documentType: documentType.trim(),
        category,
        ...(doesNotExpire ? { doesNotExpire: "true" } : expiryDate ? { expiryDate } : {}),
        ...(isSensitive ? { isSensitive: "true" } : {}),
        ...(siteId ? { siteId } : {}),
      });
      setShowUpload(false);
      setTitle("");
      setDocumentType("");
      setFile(null);
      setExpiryDate("");
      setDoesNotExpire(false);
      setIsSensitive(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc: ManagedDocument) => {
    if (!token || !doc.downloadUrl) return;
    try {
      await downloadPrivateFile(token, doc.downloadUrl, doc.fileName);
    } catch (err: any) {
      setError(err?.message || "Document download failed");
    }
  };

  const handleArchive = async (doc: ManagedDocument) => {
    if (!token) return;
    try {
      await archiveDocument(token, doc.id);
      await refresh();
    } catch (err: any) {
      setError(err?.message || "Failed to archive document");
    }
  };

  return (
    <div className="animate-fade-in max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Document Management"
        description="Unified document repository and PDF workspace for employee records, client contracts, compliance files, and system-generated financial packs."
        actions={
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => setShowUpload(true)}
            >
              + Upload Document
            </Button>
          ) : undefined
        }
      />

      {/* Filter and Search Strip */}
      <div className="bg-white border border-security-navy-200 rounded-security-lg p-4 shadow-xs flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input
            placeholder="Search documents, entities, or authority..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs"
          />
        </div>

        <div className="w-44">
          <Select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full text-xs"
            aria-label="Filter by category"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-36">
          <Select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value)}
            className="w-full text-xs"
            aria-label="Filter by origin"
          >
            {ORIGINS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-36">
          <Select
            value={lifecycleFilter}
            onChange={(e) => setLifecycleFilter(e.target.value)}
            className="w-full text-xs"
            aria-label="Filter by lifecycle"
          >
            {LIFECYCLE_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>

        {(searchTerm || categoryFilter || originFilter || lifecycleFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchTerm("");
              setCategoryFilter("");
              setOriginFilter("");
              setLifecycleFilter("");
            }}
          >
            Reset Filters
          </Button>
        )}
      </div>

      {error && (
        <AlertBanner variant="error">
          {error}
        </AlertBanner>
      )}

      {/* Upload Document Modal */}
      {showUpload && canCreate && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-security-navy-900/50 p-4 backdrop-blur-[3px]">
          <div className="w-full max-w-lg bg-white rounded-security-lg border border-security-navy-200 p-6 shadow-security-elevated">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 mb-4">
              <h2 className="text-base font-bold text-security-navy-900">
                Upload New Document
              </h2>
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="text-security-navy-400 hover:text-security-navy-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpload} className="space-y-3 text-xs">
              <div>
                <label htmlFor="doc-title" className="label-text block mb-1">
                  Document Title *
                </label>
                <Input
                  id="doc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Armed Guard PSIRA Certificate"
                  required
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="doc-type" className="label-text block mb-1">
                    Document Type *
                  </label>
                  <Input
                    id="doc-type"
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                    placeholder="e.g. CONTRACT, ID_CARD"
                    required
                    className="w-full"
                  />
                </div>
                <div>
                  <label htmlFor="doc-cat" className="label-text block mb-1">
                    Category *
                  </label>
                  <Select
                    id="doc-cat"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full"
                  >
                    {CATEGORIES.filter((c) => c.value !== "").map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <label htmlFor="doc-site" className="label-text block mb-1">
                  Linked Site (optional)
                </label>
                <Select
                  id="doc-site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="w-full"
                >
                  <option value="">No site linked</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label htmlFor="doc-expiry" className="label-text block mb-1">
                  Expiry Date (optional)
                </label>
                <Input
                  id="doc-expiry"
                  type="date"
                  disabled={doesNotExpire}
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full"
                />
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
                  Sensitive document (Restricted access permissions required)
                </label>
              </div>

              <div>
                <label htmlFor="doc-file" className="label-text block mb-1">
                  Document File *
                </label>
                <input
                  id="doc-file"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-security-navy-700 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-security-navy-100 file:text-security-navy-800 hover:file:bg-security-navy-200 cursor-pointer"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-security-navy-100">
                <Button variant="secondary" onClick={() => setShowUpload(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={uploading}>
                  Upload File
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Documents Grid / Table */}
      {loading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-20 bg-security-navy-100 rounded-lg" />
          <div className="h-20 bg-security-navy-100 rounded-lg" />
          <div className="h-20 bg-security-navy-100 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((doc) => {
            const isGenerated = doc.origin === "GENERATED";
            const versionNumber = doc.currentVersion?.versionNumber || 1;

            return (
              <article
                key={doc.id}
                className="bg-white border border-security-navy-200 rounded-security-lg p-4 transition-all hover:border-security-navy-300 hover:shadow-sm flex flex-wrap items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/documents/${doc.id}`}
                      className="font-bold text-base text-security-navy-900 hover:text-security-navy-700 hover:underline flex items-center gap-1.5"
                    >
                      {doc.title}
                    </Link>

                    {/* Origin Badge */}
                    <Badge variant={isGenerated ? "warning" : "neutral"}>
                      {isGenerated ? "System Generated" : "Uploaded"}
                    </Badge>

                    {/* Version Badge */}
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-security-navy-100 text-security-navy-700 font-mono">
                      v{versionNumber}
                    </span>

                    {/* Lifecycle Status */}
                    {doc.lifecycleStatus && (
                      <Badge
                        variant={
                          doc.lifecycleStatus === "FINAL"
                            ? "success"
                            : doc.lifecycleStatus === "SUPERSEDED" || doc.lifecycleStatus === "ARCHIVED"
                            ? "neutral"
                            : "warning"
                        }
                      >
                        {doc.lifecycleStatus}
                      </Badge>
                    )}

                    {/* Sensitive Badge */}
                    {doc.isSensitive && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-100 text-red-800">
                        Sensitive
                      </span>
                    )}

                    {/* Verification Status */}
                    {doc.verificationStatus && doc.verificationStatus !== "UNVERIFIED" && (
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                          doc.verificationStatus === "VERIFIED"
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {doc.verificationStatus}
                      </span>
                    )}
                  </div>

                  {/* Metadata and Linked Entity line */}
                  <div className="text-xs text-security-navy-600 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      {doc.documentType} · {doc.category.replace(/_/g, " ")}
                    </span>
                    {doc.fileName && (
                      <span className="text-security-navy-400 font-mono">
                        ({doc.fileName})
                      </span>
                    )}
                    {doc.site?.name && (
                      <span>
                        Site: <strong>{doc.site.name}</strong>
                      </span>
                    )}
                    {doc.client?.name && (
                      <span>
                        Client: <strong>{doc.client.name}</strong>
                      </span>
                    )}
                    {doc.employee && (
                      <span>
                        Employee:{" "}
                        <strong>
                          {doc.employee.firstName} {doc.employee.lastName}
                        </strong>
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-security-navy-400 mt-1">
                    Created {new Date(doc.createdAt).toLocaleDateString()}
                    {doc.expiryDate &&
                      ` · Expires ${new Date(doc.expiryDate).toLocaleDateString()}`}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Link href={`/documents/${doc.id}`}>
                    <Button variant="primary" size="sm">
                      Open Workspace
                    </Button>
                  </Link>

                  {canExport && token && doc.downloadUrl && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleDownload(doc)}
                      title="Download latest version file"
                    >
                      Download
                    </Button>
                  )}

                  {doc.status === "ACTIVE" && token && canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleArchive(doc)}
                      title="Archive this document"
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          className="mt-6"
          title="No documents found"
          description="Upload contracts, compliance files, or generate invoices and reports to populate your document library."
          action={
            canCreate ? (
              <Button
                variant="primary"
                onClick={() => setShowUpload(true)}
              >
                + Upload Document
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
