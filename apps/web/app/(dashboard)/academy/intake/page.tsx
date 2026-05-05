"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";

type Step = 1 | 2 | 3;

interface CourseRunRow {
  id: string;
  runCode: string;
  intakeName?: string | null;
  startDate: string;
  endDate: string;
  status: string;
  capacity: number;
  enrolledCount: number;
  course: { code: string; title: string };
  branch: { name: string };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function seatsLeft(r: CourseRunRow): string {
  if (r.capacity === 0) return "No cap";
  const left = r.capacity - r.enrolledCount;
  return `${left} left`;
}

export default function AcademyIntakePage() {
  const { token } = useAuth();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const [feeAmount, setFeeAmount] = useState("");
  const [feeMethod, setFeeMethod] = useState("EFT");
  const [feeReference, setFeeReference] = useState("");
  const [waiveNotes, setWaiveNotes] = useState("");

  const [runs, setRuns] = useState<CourseRunRow[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadRuns = useCallback(() => {
    if (!token) return;
    setLoadingRuns(true);
    academyApi
      .listCourseRuns(token, undefined, { enrollable: true })
      .then((d) => setRuns((d.courseRuns as CourseRunRow[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load runs"))
      .finally(() => setLoadingRuns(false));
  }, [token]);

  useEffect(() => {
    if (step === 3 && token) loadRuns();
  }, [step, token, loadRuns]);

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !firstName.trim() || !lastName.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        idNumber: idNumber.trim() || null,
        addressLine1: addressLine1.trim() || null,
        city: city.trim() || null,
        province: province.trim() || null,
        postalCode: postalCode.trim() || null,
      };
      if (dateOfBirth) {
        body.dateOfBirth = new Date(dateOfBirth + "T12:00:00").toISOString();
      }
      const { student } = await academyApi.createStudent(token, body);
      const s = student as { id: string };
      setStudentId(s.id);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  const recordPaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !studentId) return;
    setError(null);
    setSubmitting(true);
    try {
      await academyApi.recordStudentAdminFee(token, studentId, {
        status: "paid",
        amount: feeAmount.trim(),
        method: feeMethod.trim() || null,
        reference: feeReference.trim() || null,
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record fee");
    } finally {
      setSubmitting(false);
    }
  };

  const recordWaived = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !studentId) return;
    setError(null);
    setSubmitting(true);
    try {
      await academyApi.recordStudentAdminFee(token, studentId, {
        status: "waived",
        notes: waiveNotes.trim(),
      });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to waive fee");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRun = (id: string) => {
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitEnrolments = async () => {
    if (!token || !studentId || selectedRunIds.size === 0) return;
    setError(null);
    setSubmitting(true);
    try {
      await academyApi.createEnrolmentsBatch(token, {
        studentId,
        courseRunIds: [...selectedRunIds],
      });
      window.location.href = `/academy/students/${studentId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrolment failed");
    } finally {
      setSubmitting(false);
    }
  };

  const stepClass = (n: Step) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold border ${
      step > n
        ? "bg-security-navy-500 text-black border-security-navy-700 shadow-sm"
        : step === n
          ? "bg-security-navy-100 text-black border-security-navy-500 shadow-sm"
          : "bg-white text-black border-[var(--hairline-strong)]"
    }`;

  return (
    <div className="module-shell max-w-3xl mx-auto">
      <div>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">New student intake</h1>
        <p className="page-subtitle mt-1">
          Capture details, record the admin fee, then enrol into available course runs.
        </p>
      </div>

      <ol className="flex flex-wrap items-center gap-3 text-sm">
        <li className="flex items-center gap-2">
          <span className={stepClass(1)}>{step > 1 ? "✓" : 1}</span>
          <span className={step === 1 ? "font-semibold text-black" : "text-sm text-black"}>Details</span>
        </li>
        <span className="text-black/40" aria-hidden>→</span>
        <li className="flex items-center gap-2">
          <span className={stepClass(2)}>{step > 2 ? "✓" : 2}</span>
          <span className={step === 2 ? "font-semibold text-black" : "text-sm text-black"}>Admin fee</span>
        </li>
        <span className="text-black/40" aria-hidden>→</span>
        <li className="flex items-center gap-2">
          <span className={stepClass(3)}>3</span>
          <span className={step === 3 ? "font-semibold text-black" : "text-sm text-black"}>Enrol</span>
        </li>
      </ol>

      {error && (
        <div className="notice-error">{error}</div>
      )}

      {step === 1 && (
        <form onSubmit={submitProfile} className="space-y-4 card-wireframe p-5">
          <h2 className="text-lg font-semibold text-black">Personal details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name *" value={firstName} onChange={setFirstName} required />
            <Field label="Last name *" value={lastName} onChange={setLastName} required />
            <Field label="Email" type="email" value={email} onChange={setEmail} />
            <Field label="Phone" value={phone} onChange={setPhone} />
            <Field label="ID number" value={idNumber} onChange={setIdNumber} />
            <div>
              <label className="label py-0 text-xs">Date of birth</label>
              <input
                type="date"
                className="input-compact w-full"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label py-0 text-xs">Address line 1</label>
              <input
                className="input-compact w-full"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
            </div>
            <Field label="City" value={city} onChange={setCity} />
            <Field label="Province" value={province} onChange={setProvince} />
            <Field label="Postal code" value={postalCode} onChange={setPostalCode} />
          </div>
          <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={submitting || !firstName.trim() || !lastName.trim()}>
            {submitting ? "Saving…" : "Continue"}
          </button>
        </form>
      )}

      {step === 2 && studentId && (
        <div className="space-y-6">
          <div className="card-wireframe p-5">
            <h2 className="text-lg font-semibold text-black">Record admin fee (paid)</h2>
            <form onSubmit={recordPaid} className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Amount *" value={feeAmount} onChange={setFeeAmount} placeholder="e.g. 350" required />
              <Field label="Method" value={feeMethod} onChange={setFeeMethod} />
              <div className="sm:col-span-2">
                <label className="label py-0 text-xs">Reference (optional)</label>
                <input
                  className="input-compact w-full"
                  value={feeReference}
                  onChange={(e) => setFeeReference(e.target.value)}
                  placeholder="EFT reference or receipt no."
                />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={submitting || !feeAmount.trim()}>
                  {submitting ? "Recording…" : "Mark fee as paid"}
                </button>
              </div>
            </form>
          </div>
          <div className="card-wireframe p-5">
            <h2 className="text-lg font-semibold text-black">Or waive the admin fee</h2>
            <p className="mt-1 caption">A short reason is required for audit.</p>
            <form onSubmit={recordWaived} className="mt-3 space-y-3">
              <div>
                <label className="label py-0 text-xs">Reason *</label>
                <textarea
                  className="input-modern w-full min-h-[80px] rounded-security-lg py-2"
                  value={waiveNotes}
                  onChange={(e) => setWaiveNotes(e.target.value)}
                  placeholder="e.g. Sponsored intake, staff dependant, promotion…"
                />
              </div>
              <button type="submit" className="btn-secondary text-sm py-2 px-4" disabled={submitting || !waiveNotes.trim()}>
                {submitting ? "Saving…" : "Waive admin fee"}
              </button>
            </form>
          </div>
        </div>
      )}

      {step === 3 && studentId && (
        <div className="card-wireframe p-5">
          <h2 className="text-lg font-semibold text-black">Enrol in course runs</h2>
          <p className="mt-1 text-sm text-black">
            Only runs that are open for intake and have capacity are listed.
          </p>
          {loadingRuns ? (
            <p className="mt-4 text-sm text-black">Loading runs…</p>
          ) : runs.length === 0 ? (
            <div className="notice-warn mt-4">
              No enrolable course runs right now. Create a run with status planned or open and available seats, then
              return to this student&apos;s profile to enrol.
            </div>
          ) : (
            <ul className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {runs.map((r) => {
                const checked = selectedRunIds.has(r.id);
                return (
                  <li key={r.id}>
                    <label className={`flex cursor-pointer gap-3 rounded-security border p-3 transition-colors ${checked ? "border-security-navy-400 bg-security-navy-50" : "border-[var(--hairline)] hover:bg-[var(--bg-nav-hover)]"}`}>
                      <input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={checked} onChange={() => toggleRun(r.id)} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-mono text-xs font-semibold text-black">{r.runCode}</span>
                        <span className="ml-2 text-sm text-black font-medium">
                          {r.course.code} — {r.course.title}
                        </span>
                        <span className="mt-0.5 block caption">
                          {r.branch.name} · {formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.status} ·{" "}
                          {seatsLeft(r)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-sm py-2 px-4"
              disabled={submitting || selectedRunIds.size === 0 || runs.length === 0}
              onClick={() => void submitEnrolments()}
            >
              {submitting ? "Enrolling…" : `Enrol in ${selectedRunIds.size} run(s)`}
            </button>
            <button
              type="button"
              className="btn-ghost text-sm py-2 px-3"
              disabled={submitting}
              onClick={() => studentId && (window.location.href = `/academy/students/${studentId}`)}
            >
              Skip — open profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label py-0 text-xs">{label}</label>
      <input
        type={type}
        className="input-compact w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}
