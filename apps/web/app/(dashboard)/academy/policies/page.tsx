"use client";

import { hasCapability } from "@/lib/permissions";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { AlertBanner, Button, PageHeader, TableEmptyRow, TableLoadingRow } from "@/components/ui";

interface Policy {
  id: string;
  policyType: string;
  version: string;
  nextReviewDate?: string | null;
}

export default function AcademyPoliciesPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));
  const [rows, setRows] = useState<Policy[]>([]);
  const [policyType, setPolicyType] = useState("Enrolment Policy");
  const [version, setVersion] = useState("1.0");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listPolicies(token)
      .then((r) => setRows((r.policies as Policy[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load policies."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !policyType.trim() || !version.trim() || !canCreate) return;
    setSaving(true);
    setError(null);
    try { await academyApi.createPolicy(token, { policyType: policyType.trim(), version: version.trim() }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!token || !canDelete) return;
    try { await academyApi.deletePolicy(token, id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader title="Policies & SOPs" description="Maintain policy versions, review cadence, and governance records." />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Add policy version</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label htmlFor="policy-type">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Policy type</span>
            <input id="policy-type" className="input-modern w-full rounded-xl" value={policyType} onChange={(e) => setPolicyType(e.target.value)} />
          </label>
          <label htmlFor="policy-version">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Version</span>
            <input id="policy-version" className="input-modern rounded-xl" value={version} onChange={(e) => setVersion(e.target.value)} />
          </label>
          <Button type="submit" disabled={!canCreate} loading={saving}>Add policy</Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Policy library</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm" aria-busy={loading}>
            <caption className="sr-only">Academy policies and SOPs</caption>
            <thead><tr className="text-[11px] uppercase tracking-wide text-neutral-500"><th scope="col">Policy type</th><th scope="col">Version</th><th scope="col">Next review</th><th scope="col" className="text-right">Action</th></tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={4} label="Loading policies..." />
              ) : rows.length === 0 ? (
                <TableEmptyRow colSpan={4} message="No policies have been added yet. Add policy versions to keep Academy governance records current." />
              ) : (
                rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.policyType}</td><td>{r.version}</td><td>{r.nextReviewDate ? String(r.nextReviewDate).slice(0,10) : "—"}</td><td className="text-right">{canDelete && <Button variant="destructive" size="sm" onClick={() => remove(r.id)}>Delete</Button>}</td></tr>)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
