"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";

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
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
      step >= n ? "bg-primary text-primary-content" : "bg-base-300 text-base-content/60"
    }`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/academy" className="text-sm text-primary hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">New student intake</h1>
        <p className="mt-1 text-sm text-base-content/70">
          Capture details, record the admin fee, then enrol into available course runs.
        </p>
      </div>

      <ol className="flex flex-wrap items-center gap-3 text-sm">
        <li className="flex items-center gap-2">
          <span className={stepClass(1)}>1</span>
          <span className={step === 1 ? "font-medium" : "text-base-content/70"}>Details</span>
        </li>
        <span className="text-base-content/30">→</span>
        <li className="flex items-center gap-2">
          <span className={stepClass(2)}>2</span>
          <span className={step === 2 ? "font-medium" : "text-base-content/70"}>Admin fee</span>
        </li>
        <span className="text-base-content/30">→</span>
        <li className="flex items-center gap-2">
          <span className={stepClass(3)}>3</span>
          <span className={step === 3 ? "font-medium" : "text-base-content/70"}>Enrol</span>
        </li>
      </ol>

      {error && (
        <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</div>
      )}

      {step === 1 && (
        <form onSubmit={submitProfile} className="space-y-4 rounded-lg border border-base-300 bg-base-100 p-5 shadow-sm">
          <h2 className="text-lg font-medium">Personal details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name *" value={firstName} onChange={setFirstName} required />
            <Field label="Last name *" value={lastName} onChange={setLastName} required />
            <Field label="Email" type="email" value={email} onChange={setEmail} />
            <Field label="Phone" value={phone} onChange={setPhone} />
            <Field label="ID number" value={idNumber} onChange={setIdNumber} />
            <div>
              <label className="label py-0 text-xs">Date of birth</label>
              <DateInput
                value={dateOfBirth}
                onChange={setDateOfBirth}
                className="input-compact"
                ariaLabel="Date of birth"
                pastOnly
                showToday={false}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label py-0 text-xs">Address line 1</label>
              <input
                className="input input-bordered input-sm w-full"
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
            </div>
            <Field label="City" value={city} onChange={setCity} />
            <Field label="Province" value={province} onChange={setProvince} />
            <Field label="Postal code" value={postalCode} onChange={setPostalCode} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !firstName.trim() || !lastName.trim()}>
            {submitting ? "Saving…" : "Continue"}
          </button>
        </form>
      )}

      {step === 2 && studentId && (
        <div className="space-y-6">
          <div className="rounded-lg border border-base-300 bg-base-100 p-5 shadow-sm">
            <h2 className="text-lg font-medium">Record admin fee (paid)</h2>
            <form onSubmit={recordPaid} className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Amount *" value={feeAmount} onChange={setFeeAmount} placeholder="e.g. 350" required />
              <Field label="Method" value={feeMethod} onChange={setFeeMethod} />
              <div className="sm:col-span-2">
                <label className="label py-0 text-xs">Reference (optional)</label>
                <input
                  className="input input-bordered input-sm w-full"
                  value={feeReference}
                  onChange={(e) => setFeeReference(e.target.value)}
                  placeholder="EFT reference or receipt no."
                />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !feeAmount.trim()}>
                  {submitting ? "Recording…" : "Mark fee as paid"}
                </button>
              </div>
            </form>
          </div>
          <div className="rounded-lg border border-base-300 bg-base-100 p-5 shadow-sm">
            <h2 className="text-lg font-medium">Or waive the admin fee</h2>
            <p className="mt-1 text-xs text-base-content/60">A short reason is required for audit.</p>
            <form onSubmit={recordWaived} className="mt-3 space-y-3">
              <div>
                <label className="label py-0 text-xs">Reason *</label>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full min-h-[80px]"
                  value={waiveNotes}
                  onChange={(e) => setWaiveNotes(e.target.value)}
                  placeholder="e.g. Sponsored intake, staff dependant, promotion…"
                />
              </div>
              <button type="submit" className="btn btn-outline btn-sm" disabled={submitting || !waiveNotes.trim()}>
                {submitting ? "Saving…" : "Waive admin fee"}
              </button>
            </form>
          </div>
        </div>
      )}

      {step === 3 && studentId && (
        <div className="rounded-lg border border-base-300 bg-base-100 p-5 shadow-sm">
          <h2 className="text-lg font-medium">Enrol in course runs</h2>
          <p className="mt-1 text-sm text-base-content/70">
            Only runs that are open for intake and have capacity are listed.
          </p>
          {loadingRuns ? (
            <p className="mt-4 text-sm text-base-content/60">Loading runs…</p>
          ) : runs.length === 0 ? (
            <p className="mt-4 text-sm text-amber-800">
              No enrolable course runs right now. Create a run with status planned or open and available seats, then
              return to this student&apos;s profile to enrol.
            </p>
          ) : (
            <ul className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {runs.map((r) => {
                const checked = selectedRunIds.has(r.id);
                return (
                  <li key={r.id}>
                    <label className="flex cursor-pointer gap-3 rounded-md border border-base-200 p-3 hover:bg-base-200/40">
                      <input type="checkbox" className="checkbox checkbox-sm mt-0.5" checked={checked} onChange={() => toggleRun(r.id)} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-mono text-xs font-semibold">{r.runCode}</span>
                        <span className="ml-2 text-base-content/80">
                          {r.course.code} — {r.course.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-base-content/60">
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
              className="btn btn-primary btn-sm"
              disabled={submitting || selectedRunIds.size === 0 || runs.length === 0}
              onClick={() => void submitEnrolments()}
            >
              {submitting ? "Enrolling…" : `Enrol in ${selectedRunIds.size} run(s)`}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
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
        className="input input-bordered input-sm w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}
