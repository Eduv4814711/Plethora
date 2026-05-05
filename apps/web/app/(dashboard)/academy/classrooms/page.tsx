"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Classrooms</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Maintain approved training rooms, capacities, and availability.
        </p>
      </header>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">New classroom</h2>
        <form onSubmit={create} className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
          <label className="min-w-0">
            <span className="label-text mb-1 block">Classroom name</span>
            <input className="input-modern w-full" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="label-text mb-1 block">Site</span>
            <select className="input-modern" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-text mb-1 block">Capacity</span>
            <input className="input-modern w-24" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary text-sm" disabled={!canManage}>
            Add classroom
          </button>
        </form>
      </div>

      <section className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 className="section-title normal-case text-base font-semibold tracking-tight">All classrooms</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
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
                  <td className="font-medium text-black">{r.classroomName}</td>
                  <td>{r.branch?.name ?? "—"}</td>
                  <td>{r.capacity}</td>
                  <td>{r.status}</td>
                  <td className="text-right">
                    {canManage && (
                      <button type="button" className="btn-danger-soft text-xs" onClick={() => remove(r.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
