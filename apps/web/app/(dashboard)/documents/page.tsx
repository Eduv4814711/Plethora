"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { listDocuments, uploadDocument, archiveDocument, type ManagedDocument } from "@/lib/msr-api";
import { authFetch, downloadPrivateFile } from "@/lib/api";
import { AlertBanner, Badge, EmptyState, PageHeader } from "@/components/ui";

const CATEGORIES = [
  "EMPLOYEE", "SITE", "CLIENT", "PAYROLL", "ATTENDANCE",
  "INCIDENT", "EQUIPMENT", "COMPLIANCE", "TASK", "OTHER",
];

export default function DocumentsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/documents", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/documents", "edit"));
  const canExport = Boolean(user && hasCapability(user, "/documents", "export"));
  const [items, setItems] = useState<ManagedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [expiryDate, setExpiryDate] = useState("");
  const [siteId, setSiteId] = useState("");
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!token) return;
    authFetch("/sites?limit=200", token)
      .then((r) => r.json())
      .then((d) => setSites((d.data ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))))
      .catch(() => setSites([]));
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const result = await listDocuments(token, {
        category: categoryFilter || undefined,
        limit: 100,
      });
      setItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load documents");
      setItems([]);
    }
  }, [token, categoryFilter]);

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
        ...(expiryDate ? { expiryDate } : {}),
        ...(siteId ? { siteId } : {}),
      });
      setShowUpload(false);
      setTitle("");
      setDocumentType("");
      setFile(null);
      setExpiryDate("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="animate-pulse h-48 bg-neutral-200 rounded-lg" />;
  }

  return (
    <div className="animate-fade-in max-w-4xl mx-auto">
      <PageHeader
        title="Documents"
        description="Store contracts, compliance files, and operational records."
        actions={canCreate ? (
          <button type="button" className="btn-primary" onClick={() => setShowUpload(true)}>
            Upload document
          </button>
        ) : undefined}
      />

      <div className="mb-4">
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input-compact w-auto"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {error && <AlertBanner variant="error" className="mb-4">{error}</AlertBanner>}

      {showUpload && canCreate && (
        <div className="card-dashboard mb-6 p-4">
          <h2 className="section-title mb-3">Upload document</h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <div>
              <label htmlFor="doc-title" className="label-text block mb-1">Title *</label>
              <input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} className="input-modern w-full" required />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="doc-type" className="label-text block mb-1">Document type *</label>
                <input id="doc-type" value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="input-modern w-full" placeholder="e.g. Contract" required />
              </div>
              <div>
                <label htmlFor="doc-cat" className="label-text block mb-1">Category</label>
                <select id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="input-modern w-full">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="doc-site" className="label-text block mb-1">Site (optional)</label>
              <select id="doc-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input-modern w-full max-w-md">
                <option value="">No site linked</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="doc-expiry" className="label-text block mb-1">Expiry date (optional)</label>
              <input id="doc-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="input-modern w-full max-w-xs" />
            </div>
            <div>
              <label htmlFor="doc-file" className="label-text block mb-1">File *</label>
              <input id="doc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input-modern w-full" required />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</button>
              <button type="button" className="btn-secondary" onClick={() => setShowUpload(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {items.map((doc) => (
          <article key={doc.id} className="card-dashboard p-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-neutral-900">{doc.title}</h2>
              <p className="text-sm text-neutral-600 mt-0.5">
                {doc.documentType} · {doc.category.replace(/_/g, " ")}
              </p>
              <p className="text-xs text-neutral-500 mt-1">
                Uploaded {new Date(doc.createdAt).toLocaleDateString()}
                {doc.expiryDate && ` · Expires ${new Date(doc.expiryDate).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant={doc.status === "ACTIVE" ? "success" : "neutral"}>{doc.status}</Badge>
              {canExport && token && doc.downloadUrl && (
                <button
                  type="button"
                  className="btn-secondary text-sm py-1.5"
                  onClick={() => {
                    void downloadPrivateFile(token, doc.downloadUrl!, doc.fileName).catch((error) =>
                      setError(error instanceof Error ? error.message : "Document download failed")
                    );
                  }}
                >
                  Download
                </button>
              )}
              {doc.status === "ACTIVE" && token && canEdit && (
                <button
                  type="button"
                  className="btn-secondary text-sm py-1.5"
                  onClick={async () => {
                    await archiveDocument(token, doc.id);
                    await refresh();
                  }}
                >
                  Archive
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {items.length === 0 && (
        <EmptyState
          className="mt-6"
          title="No documents yet"
          description="Upload contracts, policies, and compliance files for your team."
          action={canCreate ? (
            <button type="button" className="btn-primary text-sm py-1.5" onClick={() => setShowUpload(true)}>
              Upload document
            </button>
          ) : undefined}
        />
      )}
    </div>
  );
}
