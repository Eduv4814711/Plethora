"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { AlertBanner, Button, PageHeader, TableEmptyRow, TableLoadingRow } from "@/components/ui";

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([academyApi.listClassrooms(token), academyApi.listBranches(token)])
      .then(([c, b]) => {
        setRows((c.classrooms as Classroom[]) ?? []);
        setBranches((b.branches as Branch[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Unable to load classrooms."))
      .finally(() => setLoading(false));
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
    setSaving(true);
    setError(null);
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
    } finally {
      setSaving(false);
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
    <div className="w-full min-w-0 space-y-6">
      <PageHeader title="Classrooms" description="Maintain approved training rooms, capacities, and availability." />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">New classroom</h2>
        <form onSubmit={create} className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
          <label className="min-w-0" htmlFor="classroom-name">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Classroom name</span>
            <input id="classroom-name" className="input-modern w-full rounded-xl" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label htmlFor="classroom-site">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Site</span>
            <select id="classroom-site" className="input-modern rounded-xl" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          <label htmlFor="classroom-capacity">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Capacity</span>
            <input id="classroom-capacity" className="input-modern w-24 rounded-xl" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </label>
          <Button type="submit" disabled={!canManage} loading={saving}>Add classroom</Button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200/80 px-5 py-4">
          <h2 className="text-base font-semibold text-security-navy-900">All classrooms</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-neutral-200 text-sm" aria-busy={loading}>
            <caption className="sr-only">Academy classrooms</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-neutral-500">
                <th scope="col">Classroom</th>
                <th scope="col">Site</th>
                <th scope="col">Capacity</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableLoadingRow colSpan={5} label="Loading classrooms..." />
              ) : rows.length === 0 ? (
                <TableEmptyRow colSpan={5} message="No classrooms have been added yet. Add classrooms to assign course runs to approved rooms." />
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="text-sm">
                    <td className="font-medium text-security-navy-900">{r.classroomName}</td>
                    <td>{r.branch?.name ?? "—"}</td>
                    <td>{r.capacity}</td>
                    <td>{r.status}</td>
                    <td className="text-right">{canManage && <Button variant="destructive" size="sm" onClick={() => remove(r.id)}>Delete</Button>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
