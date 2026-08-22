"use client";

import { hasCapability } from "@/lib/permissions";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";
import { AlertBanner, Badge, Button, PageHeader, TableEmptyRow, TableLoadingRow } from "@/components/ui";

interface Alert {
  id: string;
  title: string;
  alertType: string;
  dueDate: string;
  severity: "green" | "amber" | "red";
  status: string;
}

export default function AcademyRenewalsPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));
  const [rows, setRows] = useState<Alert[]>([]);
  const [title, setTitle] = useState("");
  const [alertType, setAlertType] = useState("Accreditation expiry");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listRenewals(token)
      .then((r) => setRows((r.alerts as Alert[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load renewals."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !title.trim() || !dueDate || !canCreate) return;
    setSaving(true);
    setError(null);
    try { await academyApi.createRenewal(token, { title: title.trim(), alertType, dueDate }); setTitle(""); setDueDate(""); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!token || !canDelete) return;
    try { await academyApi.deleteRenewal(token, id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      <PageHeader title="Renewals & Alerts" description="Track upcoming expiry deadlines with standardized traffic-light severity." />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-security-navy-500">Create alert</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <label htmlFor="renewal-title">
            <span className="label-text mb-1 block">Alert title</span>
            <input id="renewal-title" className="input-modern rounded-security-lg" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label htmlFor="renewal-type">
            <span className="label-text mb-1 block">Type</span>
            <input id="renewal-type" className="input-modern rounded-security-lg" value={alertType} onChange={(e) => setAlertType(e.target.value)} />
          </label>
          <DateInput value={dueDate} onChange={setDueDate} className="input-modern" showToday ariaLabel="Alert due date" />
          <Button type="submit" disabled={!canCreate} loading={saving}>Add alert</Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="border-b border-security-navy-100/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Alerts register</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm" aria-busy={loading}>
            <caption className="sr-only">Academy renewal alerts</caption>
            <thead><tr className="text-[11px] uppercase tracking-wide text-security-navy-500"><th scope="col">Alert</th><th scope="col">Type</th><th scope="col">Due</th><th scope="col">Severity</th><th scope="col">Status</th><th scope="col" className="text-right">Action</th></tr></thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={6} label="Loading renewal alerts..." />
              ) : rows.length === 0 ? (
                <TableEmptyRow colSpan={6} message="No renewal alerts have been created yet. Add expiry alerts to keep accreditation and documents current." />
              ) : (
                rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.title}</td><td>{r.alertType}</td><td>{String(r.dueDate).slice(0,10)}</td><td><Badge variant={r.severity === "red" ? "error" : r.severity === "amber" ? "warning" : "success"}>{r.severity}</Badge></td><td>{r.status}</td><td className="text-right">{canDelete && <Button variant="destructive" size="sm" onClick={() => remove(r.id)}>Delete</Button>}</td></tr>)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
