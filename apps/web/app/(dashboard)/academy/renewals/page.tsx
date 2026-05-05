"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Renewals & alerts</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Track upcoming expiry deadlines with standardized traffic-light severity.
        </p>
      </header>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">Create alert</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
          <input className="input-modern" placeholder="Alert title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className="input-modern" placeholder="Type" value={alertType} onChange={(e) => setAlertType(e.target.value)} />
          <input className="input-modern" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <button type="submit" className="btn-primary text-sm" disabled={!canManage}>
            Add
          </button>
        </form>
      </div>

      <section className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 className="section-title normal-case text-base font-semibold tracking-tight">Alerts register</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Alert</th><th>Type</th><th>Due</th><th>Severity</th><th>Status</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((r)=><tr key={r.id} className="text-sm"><td className="font-medium text-black">{r.title}</td><td>{r.alertType}</td><td>{String(r.dueDate).slice(0,10)}</td><td><span className={r.severity === "red" ? "badge-error" : r.severity === "amber" ? "badge-warning" : "badge-success"}>{r.severity}</span></td><td>{r.status}</td><td className="text-right">{canManage && <button type="button" className="btn-danger-soft text-xs" onClick={() => remove(r.id)}>Delete</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
