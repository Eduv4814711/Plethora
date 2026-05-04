"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface StudentRow {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  status: string;
  adminFeeStatus?: string;
  email?: string | null;
  _count?: { documents: number; enrolments: number };
}

function AdminFeeBadge({ status }: { status?: string }) {
  const s = status ?? "unpaid";
  const cls =
    s === "paid"
      ? "badge-success"
      : s === "waived"
        ? "badge-info"
        : "badge-neutral";
  return <span className={`badge-neutral ${cls}`}>{s}</span>;
}

export default function AcademyStudentsPage() {
  const { token } = useAuth();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    const params = q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : "";
    academyApi
      .listStudents(token, q.trim().length >= 2 ? q.trim() : undefined, 100)
      .then((d) => {
        setStudents((d.students as StudentRow[]) ?? []);
        setTotal(d.total ?? 0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
  }, [q]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !firstName.trim() || !lastName.trim()) return;
    setError(null);
    try {
      const { student } = await academyApi.createStudent(token, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      setFirstName("");
      setLastName("");
      const s = student as StudentRow;
      window.location.href = `/academy/students/${s.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  return (
    <div className="module-shell">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/academy" className="text-sm font-semibold text-security-navy-800 hover:underline lg:hidden">
            ← Academy
          </Link>
          <h1 className="page-title mt-1">Students</h1>
          <p className="text-sm text-black">{total} total</p>
        </div>
        <Link href="/academy/intake" className="btn-primary text-sm py-2 px-4">
          New intake
        </Link>
      </div>

      {error && (
        <div className="rounded-md border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-200 p-4">
        <div>
          <label className="label py-0 text-xs">First name</label>
          <input
            className="input-compact"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div>
          <label className="label py-0 text-xs">Last name</label>
          <input
            className="input-compact"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={!firstName.trim() || !lastName.trim()}>
          Create student
        </button>
      </form>

      <div>
        <label className="label py-0 text-xs">Search (min 2 characters)</label>
        <input
          className="input-compact max-w-md"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, number, ID, email…"
        />
      </div>

      {loading ? (
        <p className="text-sm text-black">Loading…</p>
      ) : students.length === 0 ? (
        <p className="text-sm text-black">No students match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="table-module">
            <thead>
              <tr>
                <th>Number</th>
                <th>Name</th>
                <th>Status</th>
                <th>Admin fee</th>
                <th>Docs</th>
                <th>Enrolments</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/academy/students/${s.id}`} className="font-mono font-semibold text-security-navy-800 underline hover:no-underline text-xs">
                      {s.studentNumber}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/academy/students/${s.id}`} className="link">
                      {s.firstName} {s.lastName}
                    </Link>
                  </td>
                  <td>{s.status}</td>
                  <td>
                    <AdminFeeBadge status={s.adminFeeStatus} />
                  </td>
                  <td>{s._count?.documents ?? 0}</td>
                  <td>{s._count?.enrolments ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
