"use client";

import { hasCapability } from "@/lib/permissions";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";
import { useConfirmDialog } from "@/components/ui";

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
      return "badge-neutral border border-security-navy-200";
  }
}

export default function AcademyCertificatesPage() {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canApprove = Boolean(user && hasCapability(user, "/academy", "approve"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));
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
    if (!token || !learnerId || !courseId || !issueDate || !canCreate) return;
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
    if (!token || !canApprove) return;
    const confirmed = await confirm({
      title: "Mark certificate as reprinted?",
      message: "This records a certificate reprint event in the register.",
      confirmLabel: "Mark reprinted",
      danger: false,
    });
    if (!confirmed) return;
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
    if (!token || !canApprove) return;
    const confirmed = await confirm({
      title: "Revoke certificate?",
      message: "This marks the certificate as revoked.",
      confirmLabel: "Revoke certificate",
    });
    if (!confirmed) return;
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
    if (!token || !canDelete) return;
    const confirmed = await confirm({
      title: "Delete certificate permanently?",
      message: "This permanently removes the certificate record.",
      confirmLabel: "Delete certificate",
    });
    if (!confirmed) return;
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
    <div className="w-full min-w-0 space-y-6">
      {confirmDialog}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-security-navy-900">Certificates</h1>
        <p className="mt-1 text-sm text-security-navy-600">Issue and manage learner certificate lifecycle with verification codes.</p>
      </div>

      {!canCreate && !canApprove && !canDelete && (
        <div className="rounded-lg border border-security-navy-200 bg-security-navy-50/50 px-3 py-2 text-sm">
          Read-only: certificate changes have not been granted for your account.
        </div>
      )}

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-security-navy-500">Issue certificate</h2>
        <form onSubmit={create} className="mt-3 grid gap-2 md:grid-cols-4">
          <select
            className="input-modern rounded-security-lg"
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            disabled={!canCreate || saving}
          >
            <option value="">Select learner</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.studentNumber} — {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
          <select
            className="input-modern rounded-security-lg"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            disabled={!canCreate || saving}
          >
            <option value="">Select course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <DateInput
            value={issueDate}
            onChange={setIssueDate}
            className="input-modern"
            showToday
            disabled={!canCreate || saving}
            ariaLabel="Certificate issue date"
          />
          <button className="btn-primary rounded-security-lg" disabled={!canCreate || saving || !learnerId || !courseId || !issueDate}>
            Issue
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-security-navy-100 bg-white shadow-security-card">
        <div className="border-b border-security-navy-100/80 px-5 py-4"><h2 className="text-base font-semibold text-security-navy-900">Certificate register</h2></div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-security-navy-500"><th>Certificate #</th><th>Learner</th><th>Status</th><th>Verification</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-security-navy-500">
                    Loading certificates...
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="text-sm">
                  <td className="font-medium text-security-navy-900">{r.certificateNumber}</td>
                  <td>{r.learner ? `${r.learner.firstName} ${r.learner.lastName}` : r.learnerId}</td>
                  <td>
                    <span className={`badge-neutral ${statusBadgeClass(r.status)}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="font-mono text-xs">{r.verificationCode}</td>
                  <td className="text-right space-x-1">
                    {canApprove && <button className="btn-secondary px-2 py-1 text-xs" onClick={() => reprint(r.id)} disabled={saving}>Reprint</button>}
                    {canApprove && <button className="btn-amber px-2 py-1 text-xs" onClick={() => revoke(r.id)} disabled={saving}>Revoke</button>}
                    {canDelete && <button className="btn-destructive px-2 py-1 text-xs" onClick={() => remove(r.id)} disabled={saving}>Delete</button>}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-security-navy-500">
                    No certificates yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
