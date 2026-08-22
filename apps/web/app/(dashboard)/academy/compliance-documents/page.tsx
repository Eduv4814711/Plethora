"use client";

import { hasCapability } from "@/lib/permissions";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";
import { AlertBanner, Button, PageHeader, TableEmptyRow, TableLoadingRow } from "@/components/ui";

interface Doc {
  id: string;
  documentName: string;
  documentType: string;
  status: string;
  expiryDate?: string | null;
}

export default function AcademyComplianceDocumentsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));
  const [rows, setRows] = useState<Doc[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("PSIRA Registration Certificate");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listComplianceDocuments(token)
      .then((r) => setRows((r.documents as Doc[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load compliance documents."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim() || !canCreate) return;
    setSaving(true);
    setError(null);
    try {
      await academyApi.createComplianceDocument(token, { documentName: name.trim(), documentType: type, expiryDate: expiryDate || null });
      setName(""); setExpiryDate("");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!token || !canDelete) return;
    try { await academyApi.deleteComplianceDocument(token, id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader title="Compliance Documents" description="Track document completeness, verification, and expiry posture." />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-security-navy-500">Add document</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-4">
          <label className="md:col-span-2" htmlFor="compliance-document-name">
            <span className="label-text mb-1 block">Document name</span>
            <input id="compliance-document-name" className="input-modern rounded-security-lg" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label htmlFor="compliance-document-type">
            <span className="label-text mb-1 block">Document type</span>
            <input id="compliance-document-type" className="input-modern rounded-security-lg" value={type} onChange={(e) => setType(e.target.value)} />
          </label>
          <DateInput value={expiryDate} onChange={setExpiryDate} className="input-modern" showToday ariaLabel="Document expiry date" />
          <Button type="submit" className="md:col-span-4 md:justify-self-end" disabled={!canCreate} loading={saving}>Add document</Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="border-b border-security-navy-100/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Document vault</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loading}>
            <caption className="sr-only">Academy compliance documents</caption>
            <thead><tr className="text-[11px] uppercase tracking-wide text-security-navy-500"><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Expiry</th><th scope="col" className="text-right">Action</th></tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={5} label="Loading compliance documents..." />
              ) : rows.length === 0 ? (
                <TableEmptyRow colSpan={5} message="No compliance documents have been added yet. Add required documents to track completeness and expiry." />
              ) : (
                rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.documentName}</td><td>{r.documentType}</td><td>{r.status}</td><td>{r.expiryDate ? String(r.expiryDate).slice(0,10) : "—"}</td><td className="text-right">{canDelete && <Button variant="destructive" size="sm" onClick={() => remove(r.id)}>Delete</Button>}</td></tr>)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
