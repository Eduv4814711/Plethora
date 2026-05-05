"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Policies & SOPs</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Maintain policy versions, review cadence, and governance records.
        </p>
      </header>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">Add policy version</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label>
            <span className="label-text mb-1 block">Policy type</span>
            <input className="input-modern w-full" value={policyType} onChange={(e) => setPolicyType(e.target.value)} />
          </label>
          <label>
            <span className="label-text mb-1 block">Version</span>
            <input className="input-modern" value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary text-sm" disabled={!canManage}>
            Add
          </button>
        </form>
      </div>

      <section className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 className="section-title normal-case text-base font-semibold tracking-tight">Policy library</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Policy type</th><th>Version</th><th>Next review</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-black">{r.policyType}</td><td>{r.version}</td><td>{r.nextReviewDate ? String(r.nextReviewDate).slice(0,10) : "—"}</td><td className="text-right">{canManage && <button type="button" className="btn-danger-soft text-xs" onClick={() => remove(r.id)}>Delete</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
