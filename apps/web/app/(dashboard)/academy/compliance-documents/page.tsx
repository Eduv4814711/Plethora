"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Doc {
  id: string;
  documentName: string;
  documentType: string;
  status: string;
  expiryDate?: string | null;
}

export default function AcademyComplianceDocumentsPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Doc[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("PSIRA Registration Certificate");
  const [expiryDate, setExpiryDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => token && academyApi.listComplianceDocuments(token).then((r) => setRows((r.documents as Doc[]) ?? [])).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim() || !canManage) return;
    try {
      await academyApi.createComplianceDocument(token, { documentName: name.trim(), documentType: type, expiryDate: expiryDate || null });
      setName(""); setExpiryDate("");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    try { await academyApi.deleteComplianceDocument(token, id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="module-shell">
      <div>
        <h1 className="page-title">Compliance Documents</h1>
        <p className="mt-1 text-sm text-black">Track document completeness, verification, and expiry posture.</p>
      </div>

      {error && <div className="rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sm text-black">Add document</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-4">
          <input className="input-modern md:col-span-2" placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input-modern" value={type} onChange={(e) => setType(e.target.value)} />
          <input className="input-modern" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          <button className="btn-primary rounded-security-lg md:col-span-4 md:justify-self-end" disabled={!canManage}>Add document</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Document vault</h2></div>
        <div className="overflow-x-auto">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Name</th><th>Type</th><th>Status</th><th>Expiry</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.documentName}</td><td>{r.documentType}</td><td>{r.status}</td><td>{r.expiryDate ? String(r.expiryDate).slice(0,10) : "—"}</td><td className="text-right">{canManage && <button className="btn-danger" onClick={() => remove(r.id)}>Delete</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
