"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

interface StudentOption {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
}

interface CourseOption {
  id: string;
  code: string;
  title: string;
}

interface Certificate {
  id: string;
  learnerId: string;
  courseId?: string;
  certificateNumber: string;
  status: string;
  verificationCode: string;
  learner?: { firstName: string; lastName: string };
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "active":
      return "badge-success";
    case "reprinted":
      return "badge-warning";
    case "revoked":
    case "void":
      return "badge-error";
    default:
      return "badge-neutral";
  }
}

export default function AcademyCertificatesPage() {
  const { token, user } = useAuth();
  const canManage = user?.role === "admin";
  const [rows, setRows] = useState<Certificate[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [learnerId, setLearnerId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    academyApi
      .listCertificates(token)
      .then((r) => setRows((r.certificates as Certificate[]) ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    Promise.all([
      academyApi.listStudents(token, undefined, 200),
      academyApi.listCourses(token),
    ])
      .then(([studentsRes, coursesRes]) => {
        const learnerOptions = (studentsRes.students as StudentOption[]) ?? [];
        const courseOptions = (coursesRes.courses as CourseOption[]) ?? [];
        setStudents(learnerOptions);
        setCourses(courseOptions);
        if (!learnerId && learnerOptions.length > 0) setLearnerId(learnerOptions[0].id);
        if (!courseId && courseOptions.length > 0) setCourseId(courseOptions[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load options"));
    load();
  }, [token]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !learnerId || !courseId || !issueDate || !canManage) return;
    setSaving(true);
    try {
      await academyApi.createCertificate(token, { learnerId, courseId, issueDate });
      setLearnerId(""); setCourseId(""); setIssueDate("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const reprint = async (id: string) => {
    if (!token || !canManage) return;
    if (!confirm("Mark this certificate as reprinted?")) return;
    setSaving(true);
    try {
      await academyApi.reprintCertificate(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reprint failed");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (id: string) => {
    if (!token || !canManage) return;
    if (!confirm("Revoke this certificate?")) return;
    setSaving(true);
    try {
      await academyApi.revokeCertificate(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token || !canManage) return;
    if (!confirm("Delete this certificate permanently?")) return;
    setSaving(true);
    try {
      await academyApi.deleteCertificate(token, id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="module-shell">
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Certificates</h1>
        <p className="mt-1 max-w-xl text-sm text-black">
          Issue and manage learner certificate lifecycle with verification codes.
        </p>
      </header>

      {!canManage && (
        <div className="notice-info text-sm">
          Read-only: only admins can issue, reprint, revoke, or delete certificates.
        </div>
      )}

      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="card-wireframe p-4 sm:p-5">
        <h2 className="section-title">Issue certificate</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-4">
          <select
            className="input-modern"
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            disabled={!canManage || saving}
          >
            <option value="">Select learner</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentNumber} — {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
          <select
            className="input-modern"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            disabled={!canManage || saving}
          >
            <option value="">Select course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <input
            className="input-modern"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            disabled={!canManage || saving}
          />
          <button type="submit" className="btn-primary text-sm" disabled={!canManage || saving || !learnerId || !courseId || !issueDate}>
            Issue
          </button>
        </form>
      </div>

      <section className="card-wireframe overflow-hidden p-0">
        <div className="border-b border-[var(--hairline)] px-4 py-3 sm:px-5">
          <h2 className="section-title normal-case text-base font-semibold tracking-tight">Certificate register</h2>
        </div>
        <div className="table-scroll rounded-none border-0 shadow-none">
          <table className="table-module">
            <thead><tr className="text-[11px] uppercase tracking-wide text-sm text-black"><th>Certificate #</th><th>Learner</th><th>Status</th><th>Verification</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-black">
                    Loading certificates...
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="text-sm">
                  <td className="font-medium text-black">{r.certificateNumber}</td>
                  <td>{r.learner ? `${r.learner.firstName} ${r.learner.lastName}` : r.learnerId}</td>
                  <td>
                    <span className={statusBadgeClass(r.status)}>{r.status}</span>
                  </td>
                  <td className="font-mono text-xs">{r.verificationCode}</td>
                  <td className="text-right space-x-1">
                    <button type="button" className="btn-secondary text-xs py-2 px-3 min-h-9" onClick={() => reprint(r.id)} disabled={!canManage || saving}>Reprint</button>
                    <button type="button" className="btn-amber text-xs py-2 px-3 min-h-9" onClick={() => revoke(r.id)} disabled={!canManage || saving}>Revoke</button>
                    {canManage && (
                      <button type="button" className="btn-danger-soft text-xs" onClick={() => remove(r.id)} disabled={saving}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-black">
                    No certificates yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
