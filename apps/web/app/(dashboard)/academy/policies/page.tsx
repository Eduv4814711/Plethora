"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Policy {
  id: string;
  policyType: string;
  version: string;
  nextReviewDate?: string | null;
}

export default function AcademyPoliciesPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Policy[]>([]);
  const [policyType, setPolicyType] = useState("Enrolment Policy");
  const [version, setVersion] = useState("1.0");
  const [error, setError] = useState<string | null>(null);

  const load = () => token && academyApi.listPolicies(token).then((r) => setRows((r.policies as Policy[]) ?? [])).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !policyType.trim() || !version.trim() || !canManage) return;
    try { await academyApi.createPolicy(token, { policyType: policyType.trim(), version: version.trim() }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    try { await academyApi.deletePolicy(token, id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="module-shell">
      <div>
        <h1 className="page-title">Policies & SOPs</h1>
        <p className="mt-1 text-sm text-black">Maintain policy versions, review cadence, and governance records.</p>
      </div>

      {error && <div className="rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sm text-black">Add policy version</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">Policy type</span>
            <input className="input-modern w-full rounded-xl" value={policyType} onChange={(e) => setPolicyType(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">Version</span>
            <input className="input-modern" value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
          <button className="btn-primary rounded-security-lg" disabled={!canManage}>Add</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Policy library</h2></div>
        <div className="overflow-x-auto">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Policy type</th><th>Version</th><th>Next review</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.policyType}</td><td>{r.version}</td><td>{r.nextReviewDate ? String(r.nextReviewDate).slice(0,10) : "—"}</td><td className="text-right">{canManage && <button className="btn-danger" onClick={() => remove(r.id)}>Delete</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
