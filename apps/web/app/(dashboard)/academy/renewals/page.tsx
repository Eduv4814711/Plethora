"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

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
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Alert[]>([]);
  const [title, setTitle] = useState("");
  const [alertType, setAlertType] = useState("Accreditation expiry");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => token && academyApi.listRenewals(token).then((r) => setRows((r.alerts as Alert[]) ?? [])).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !title.trim() || !dueDate || !canManage) return;
    try { await academyApi.createRenewal(token, { title: title.trim(), alertType, dueDate }); setTitle(""); setDueDate(""); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    try { await academyApi.deleteRenewal(token, id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  };

  return (
    <div className="module-shell">
      <div>
        <h1 className="page-title">Renewals & Alerts</h1>
        <p className="mt-1 text-sm text-black">Track upcoming expiry deadlines with standardized traffic-light severity.</p>
      </div>

      {error && <div className="rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sm text-black">Create alert</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <input className="input-modern" placeholder="Alert title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input-modern" placeholder="Type" value={alertType} onChange={(e) => setAlertType(e.target.value)} />
          <input className="input-modern" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <button className="btn-primary rounded-security-lg" disabled={!canManage}>Add</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Alerts register</h2></div>
        <div className="overflow-x-auto">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Alert</th><th>Type</th><th>Due</th><th>Severity</th><th>Status</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-security-navy-900">{r.title}</td><td>{r.alertType}</td><td>{String(r.dueDate).slice(0,10)}</td><td><span className={`badge-neutral ${r.severity === "red" ? "badge-error" : r.severity === "amber" ? "badge-warning" : "badge-success"}`}>{r.severity}</span></td><td>{r.status}</td><td className="text-right">{canManage && <button className="btn-danger" onClick={() => remove(r.id)}>Delete</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
