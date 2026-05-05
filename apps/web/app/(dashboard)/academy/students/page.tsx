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
        ? "badge-primary"
        : "badge-neutral";
  return <span className={cls}>{s}</span>;
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
            ← Academy
          </Link>
          <p className="label-text mt-1">Module · Academy</p>
          <h1 className="page-title mt-1">Students</h1>
          <p className="mt-1 text-sm text-black">
            <span className="tabular-nums font-semibold">{total}</span> total learners
          </p>
        </div>
        <Link href="/academy/intake" className="btn-primary text-sm">
          New intake
        </Link>
      </header>

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <form
        onSubmit={create}
        className="card-wireframe flex flex-wrap items-end gap-3 p-4 sm:p-5"
      >
        <div>
          <label className="label-text mb-1 block">First name</label>
          <input className="input-compact max-w-[220px]" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div>
          <label className="label-text mb-1 block">Last name</label>
          <input className="input-compact max-w-[220px]" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <button
          type="submit"
          className="btn-primary text-sm"
          disabled={!firstName.trim() || !lastName.trim()}
        >
          Create student
        </button>
      </form>

      <div>
        <label className="label-text mb-1 block">Search (min 2 characters)</label>
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
        <div className="rounded-security-lg border border-dashed border-[var(--hairline-strong)] bg-white p-6 text-center text-sm text-black">
          No students match.
        </div>
      ) : (
        <div className="table-scroll">
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
                    <Link href={`/academy/students/${s.id}`} className="link-inline font-mono text-xs font-semibold">
                      {s.studentNumber}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/academy/students/${s.id}`} className="link-inline">
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
