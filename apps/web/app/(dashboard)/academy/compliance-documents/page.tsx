"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Compliance documents</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Track document completeness, verification, and expiry posture.
        </p>
      </header>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">Add document</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-4">
          <input className="input-modern md:col-span-2" placeholder="Document name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input-modern" value={type} onChange={(e) => setType(e.target.value)} />
          <input className="input-modern" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          <button type="submit" className="btn-primary text-sm md:col-span-4 md:justify-self-end" disabled={!canManage}>
            Add document
          </button>
        </form>
      </div>

      <section className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 className="section-title normal-case text-base font-semibold tracking-tight">Document vault</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Name</th><th>Type</th><th>Status</th><th>Expiry</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-black">{r.documentName}</td><td>{r.documentType}</td><td>{r.status}</td><td>{r.expiryDate ? String(r.expiryDate).slice(0,10) : "—"}</td><td className="text-right">{canManage && <button type="button" className="btn-danger-soft text-xs" onClick={() => remove(r.id)}>Delete</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
