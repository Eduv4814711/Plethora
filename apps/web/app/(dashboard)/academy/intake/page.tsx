"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import type { AcademyCourseRun, AcademyStudentDocument } from "@/lib/academy-types";
import { hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  Spinner,
} from "@/components/ui";

type Step = 1 | 2 | 3 | 4;

const REQUIRED_DOC_TYPES = [
  { value: "id_copy", label: "Certified ID / Passport Copy" },
  { value: "qualification", label: "Prior Qualification / Matric Certificate" },
  { value: "proof_of_address", label: "Proof of Residential Address" },
  { value: "consent", label: "Learner Agreement & POPIA Consent" },
  { value: "payment_proof", label: "Proof of Payment" },
  { value: "other", label: "Other Supporting Document" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function seatsLeft(r: AcademyCourseRun): string {
  if (r.capacity === 0) return "No cap";
  const left = r.capacity - r.enrolledCount;
  return `${left} left`;
}

export default function AcademyIntakePage() {
  const router = useRouter();
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/academy", "edit"));

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);

  // Step 1: Personal Details
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

  // Step 2: Admin Fee
  const [feeAmount, setFeeAmount] = useState("");
  const [feeMethod, setFeeMethod] = useState("EFT");
  const [feeReference, setFeeReference] = useState("");
  const [waiveNotes, setWaiveNotes] = useState("");

  // Step 3: Document Collection
  const [documents, setDocuments] = useState<AcademyStudentDocument[]>([]);
  const [selectedDocType, setSelectedDocType] = useState("id_copy");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Step 4: Course Run Enrolment
  const [runs, setRuns] = useState<AcademyCourseRun[]>([]);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Load uploaded documents when entering Step 3
  const loadDocuments = useCallback(
    (sId: string) => {
      if (!token) return;
      setLoadingDocs(true);
      academyApi
        .listStudentDocuments(token, sId)
        .then((res) => {
          setDocuments((res.documents as AcademyStudentDocument[]) ?? []);
        })
        .catch(() => {
          // ignore
        })
        .finally(() => setLoadingDocs(false));
    },
    [token]
  );

  useEffect(() => {
    if (step === 3 && studentId) {
      loadDocuments(studentId);
    }
  }, [step, studentId, loadDocuments]);

  // Load available course runs when entering Step 4
  const loadRuns = useCallback(() => {
    if (!token) return;
    setLoadingRuns(true);
    academyApi
      .listCourseRuns(token, undefined, { enrollable: true })
      .then((d) => setRuns((d.courseRuns as AcademyCourseRun[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load runs"))
      .finally(() => setLoadingRuns(false));
  }, [token]);

  useEffect(() => {
    if (step === 4 && token) loadRuns();
  }, [step, token, loadRuns]);

  const submitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !firstName.trim() || !lastName.trim() || !canCreate) return;
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
    if (!token || !studentId || !canEdit) return;
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
    if (!token || !studentId || !canEdit) return;
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

  const uploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !studentId || !selectedFile || !canEdit) return;
    setError(null);
    setUploadingDoc(true);
    try {
      await academyApi.uploadStudentDocument(token, studentId, selectedFile, selectedDocType);
      setSelectedFile(null);
      // Reset input element value
      const fileInput = document.getElementById("intake-file-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      loadDocuments(studentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Document upload failed");
    } finally {
      setUploadingDoc(false);
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
    if (!token || !studentId || selectedRunIds.size === 0 || !canCreate) return;
    setError(null);
    setSubmitting(true);
    try {
      await academyApi.createEnrolmentsBatch(token, {
        studentId,
        courseRunIds: [...selectedRunIds],
      });
      router.push(`/academy/students/${studentId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrolment failed");
    } finally {
      setSubmitting(false);
    }
  };

  const stepClass = (n: Step) =>
    `flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
      step === n
        ? "bg-security-navy text-white ring-2 ring-security-amber-500 ring-offset-2"
        : step > n
          ? "bg-security-navy-700 text-white"
          : "bg-security-navy-100 text-security-navy-500"
    }`;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div>
        <Link href="/academy" className="text-sm text-security-navy-700 hover:underline lg:hidden">
          ← Academy
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-security-navy-900">
          New Student Intake Wizard
        </h1>
        <p className="mt-1 text-sm text-security-navy-600">
          Guided 4-step intake: capture personal details, register admin fee, collect required documents, and enrol into course runs.
        </p>
      </div>

      {/* 4-Step Progress Indicator */}
      <nav aria-label="Intake Wizard Steps">
        <ol className="flex flex-wrap items-center gap-2 text-xs sm:gap-3 sm:text-sm">
          <li className="flex items-center gap-1.5">
            <span className={stepClass(1)}>1</span>
            <span className={step === 1 ? "font-semibold text-security-navy-900" : "text-security-navy-600"}>
              Details
            </span>
          </li>
          <span className="text-security-navy-300">→</span>
          <li className="flex items-center gap-1.5">
            <span className={stepClass(2)}>2</span>
            <span className={step === 2 ? "font-semibold text-security-navy-900" : "text-security-navy-600"}>
              Admin Fee
            </span>
          </li>
          <span className="text-security-navy-300">→</span>
          <li className="flex items-center gap-1.5">
            <span className={stepClass(3)}>3</span>
            <span className={step === 3 ? "font-semibold text-security-navy-900" : "text-security-navy-600"}>
              Documents
            </span>
          </li>
          <span className="text-security-navy-300">→</span>
          <li className="flex items-center gap-1.5">
            <span className={stepClass(4)}>4</span>
            <span className={step === 4 ? "font-semibold text-security-navy-900" : "text-security-navy-600"}>
              Enrolment
            </span>
          </li>
        </ol>
      </nav>

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Step 1: Permission Denial Guard */}
      {step === 1 && !canCreate && (
        <AlertBanner variant="warning">
          Your account does not have permission to register new students. Contact an administrator to request Academy create access.
        </AlertBanner>
      )}

      {/* Step 1: Personal Details Form */}
      {step === 1 && canCreate && (
        <form
          onSubmit={submitProfile}
          className="space-y-4 rounded-2xl border border-security-navy-100 bg-white p-6 shadow-security-card"
        >
          <h2 className="text-lg font-semibold text-security-navy-900">Step 1: Personal Details</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name *" value={firstName} onChange={setFirstName} required />
            <Field label="Last name *" value={lastName} onChange={setLastName} required />
            <Field label="Email" type="email" value={email} onChange={setEmail} />
            <Field label="Phone" value={phone} onChange={setPhone} />
            <Field label="ID / Passport Number" value={idNumber} onChange={setIdNumber} />
            <div>
              <label className="label-text mb-1 block">Date of birth</label>
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
              <label className="label-text mb-1 block">Address line 1</label>
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
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={submitting || !firstName.trim() || !lastName.trim()}
              loading={submitting}
            >
              Continue to Admin Fee
            </Button>
          </div>
        </form>
      )}

      {/* Step 2: Admin Fee */}
      {step === 2 && studentId && !canEdit && (
        <AlertBanner variant="warning">
          Your account can create the student but cannot record or waive the admin fee. Ask a coordinator with edit access to continue, or{" "}
          <Link href={`/academy/students/${studentId}`} className="font-semibold underline">
            open the profile directly
          </Link>
          .
        </AlertBanner>
      )}

      {step === 2 && studentId && canEdit && (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-security-navy-900">
              Step 2: Record Admin Fee (Paid)
            </h2>
            <form onSubmit={recordPaid} className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Amount (ZAR) *"
                value={feeAmount}
                onChange={setFeeAmount}
                placeholder="e.g. 350"
                required
              />
              <Field label="Payment Method" value={feeMethod} onChange={setFeeMethod} />
              <div className="sm:col-span-2">
                <label className="label-text mb-1 block">Reference (optional)</label>
                <input
                  className="input-compact w-full"
                  value={feeReference}
                  onChange={(e) => setFeeReference(e.target.value)}
                  placeholder="EFT reference or receipt no."
                />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit" disabled={submitting || !feeAmount.trim()} loading={submitting}>
                  Mark Admin Fee as Paid
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold text-security-navy-900">
              Or Waive the Admin Fee
            </h2>
            <p className="mt-1 text-xs text-security-navy-500">
              A clear reason is required for compliance and audit verification.
            </p>
            <form onSubmit={recordWaived} className="mt-3 space-y-3">
              <div>
                <label className="label-text mb-1 block">Reason for waiver *</label>
                <textarea
                  className="input-modern w-full min-h-[80px]"
                  value={waiveNotes}
                  onChange={(e) => setWaiveNotes(e.target.value)}
                  placeholder="e.g. Sponsored corporate intake, staff dependant, scholarship..."
                  required
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={submitting || !waiveNotes.trim()}
                  loading={submitting}
                >
                  Waive Admin Fee & Continue
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Step 3: Document Collection Step */}
      {step === 3 && studentId && (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-security-navy-900">
              Step 3: Document Collection
            </h2>
            <p className="mt-1 text-xs text-security-navy-600">
              Upload mandatory onboarding documents (ID document, proof of residence, prior qualifications).
            </p>

            {canEdit ? (
              <form onSubmit={uploadDoc} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
                <div>
                  <label className="label-text mb-1 block" htmlFor="intake-doc-type">
                    Document Type *
                  </label>
                  <select
                    id="intake-doc-type"
                    className="input-modern w-full rounded-security-lg"
                    value={selectedDocType}
                    onChange={(e) => setSelectedDocType(e.target.value)}
                    disabled={uploadingDoc}
                  >
                    {REQUIRED_DOC_TYPES.map((dt) => (
                      <option key={dt.value} value={dt.value}>
                        {dt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label-text mb-1 block" htmlFor="intake-file-input">
                    Select File (PDF/Image) *
                  </label>
                  <input
                    id="intake-file-input"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="input-modern w-full text-xs"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    disabled={uploadingDoc}
                  />
                </div>

                <Button type="submit" disabled={!selectedFile} loading={uploadingDoc}>
                  Upload File
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-security-navy-500">
                You do not have permission to upload documents for this learner.
              </p>
            )}

            {/* List of uploaded documents so far */}
            <div className="mt-6 border-t border-security-navy-100 pt-4">
              <h3 className="text-sm font-semibold text-security-navy-900">
                Collected Documents ({documents.length})
              </h3>
              {loadingDocs ? (
                <div className="py-4 text-center text-xs text-security-navy-500">
                  <Spinner className="mx-auto h-4 w-4" />
                </div>
              ) : documents.length === 0 ? (
                <p className="mt-2 text-xs text-security-navy-500">
                  No documents uploaded yet. You can upload them now or continue and upload them later from the learner profile.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-security-navy-100 rounded-lg border border-security-navy-100 text-xs">
                  {documents.map((d) => (
                    <li key={d.id} className="flex items-center justify-between p-2.5">
                      <div className="min-w-0 flex-1 pr-2">
                        <span className="font-medium text-security-navy-900">{d.fileName}</span>
                        <span className="ml-2 text-security-navy-500">
                          ({d.documentType})
                        </span>
                      </div>
                      <Badge variant="success">Uploaded</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Step 3 Navigation Controls */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-security-navy-100 pt-4">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStep(4)}
              >
                Skip Document Step →
              </Button>
              <Button
                size="sm"
                onClick={() => setStep(4)}
              >
                Continue to Enrolment ({documents.length} uploaded) →
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Step 4: Course Run Enrolment */}
      {step === 4 && studentId && canCreate && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-security-navy-900">
            Step 4: Enrol in Course Runs
          </h2>
          <p className="mt-1 text-sm text-security-navy-600">
            Select one or more available course runs to enrol the learner into immediately.
          </p>

          {loadingRuns ? (
            <div className="py-8 text-center text-sm text-security-navy-500 flex items-center justify-center gap-2">
              <Spinner />
              <span>Loading available course runs...</span>
            </div>
          ) : runs.length === 0 ? (
            <p className="mt-4 rounded-lg border border-security-amber-200 bg-security-amber-50 p-3 text-sm text-security-amber-900">
              No enrolable course runs found. You can proceed to the learner profile and enrol once runs are scheduled.
            </p>
          ) : (
            <ul className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {runs.map((r) => {
                const checked = selectedRunIds.has(r.id);
                return (
                  <li key={r.id}>
                    <label className="flex cursor-pointer gap-3 rounded-lg border border-security-navy-100 p-3 hover:bg-security-navy-50/40">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-security-navy-300 text-security-navy-600 focus:ring-security-navy-500"
                        checked={checked}
                        onChange={() => toggleRun(r.id)}
                      />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-mono text-xs font-semibold text-security-navy-900">
                          {r.runCode}
                        </span>
                        <span className="ml-2 text-security-navy-700">
                          {r.course?.code} — {r.course?.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-security-navy-500">
                          {r.branch?.name} · {formatDate(r.startDate)} – {formatDate(r.endDate)} ·{" "}
                          <span className="capitalize">{r.status}</span> · {seatsLeft(r)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-security-navy-100 pt-4">
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => router.push(`/academy/students/${studentId}`)}
            >
              Skip Enrolment — Open Profile
            </Button>
            <Button
              disabled={submitting || selectedRunIds.size === 0 || runs.length === 0}
              loading={submitting}
              onClick={() => void submitEnrolments()}
            >
              Complete Intake & Enrol ({selectedRunIds.size})
            </Button>
          </div>
        </Card>
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
      <label className="label-text mb-1 block">{label}</label>
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
