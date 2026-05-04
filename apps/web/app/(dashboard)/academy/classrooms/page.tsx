"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface Classroom {
  id: string;
  classroomName: string;
  status: string;
  capacity: number;
  branch?: { name: string };
}
interface Branch {
  id: string;
  name: string;
}

export default function AcademyClassroomsPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Classroom[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [capacity, setCapacity] = useState("20");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    Promise.all([academyApi.listClassrooms(token), academyApi.listBranches(token)])
      .then(([c, b]) => {
        setRows((c.classrooms as Classroom[]) ?? []);
        setBranches((b.branches as Branch[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (branches.length && !branchId) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim() || !branchId || !canManage) return;
    try {
      await academyApi.createClassroom(token, {
        academyBranchId: branchId,
        classroomName: name.trim(),
        capacity: Number(capacity) || 0,
      });
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    try {
      await academyApi.deleteClassroom(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="module-shell">
      <div>
        <h1 className="page-title">Classrooms</h1>
        <p className="mt-1 text-sm text-black">Maintain approved training rooms, capacities, and availability.</p>
      </div>

      {error && <div className="rounded-lg border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sm text-black">New classroom</h2>
        <form onSubmit={create} className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
          <label className="min-w-0">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">Classroom name</span>
            <input className="input-modern w-full rounded-xl" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">Site</span>
            <select className="input-modern rounded-security-lg" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-sm text-black">Capacity</span>
            <input className="input-modern w-24 rounded-xl" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </label>
          <button className="btn-primary rounded-security-lg" disabled={!canManage}>Add classroom</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-security-navy-900">All classrooms</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="table-module">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-sm text-black">
                <th>Classroom</th>
                <th>Site</th>
                <th>Capacity</th>
                <th>Status</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="text-sm">
                  <td className="font-medium text-security-navy-900">{r.classroomName}</td>
                  <td>{r.branch?.name ?? "—"}</td>
                  <td>{r.capacity}</td>
                  <td>{r.status}</td>
                  <td className="text-right">{canManage && <button className="btn-danger" onClick={() => remove(r.id)}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
