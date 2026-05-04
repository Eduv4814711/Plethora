"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { academyApi, uploadAcademyStudentDocument } from "@/lib/api";

interface Student {
  id: string;
  studentNumber: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  preferredName?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  psiraProfileReference?: string | null;
  psiraPreRegistrationStatus: string;
  status: string;
  adminFeeStatus?: string;
  adminFeePaidAt?: string | null;
  adminFeeAmount?: string | null;
  adminFeeMethod?: string | null;
  adminFeeReference?: string | null;
  adminFeeNotes?: string | null;
}

interface DocRow {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy?: { name: string };
}

const docTypes = [
  { value: "id_copy", label: "ID copy" },
  { value: "proof_of_address", label: "Proof of address" },
  { value: "passport_permit", label: "Passport / permit" },
  { value: "qualification", label: "Qualification" },
  { value: "application_form", label: "Application form" },
  { value: "payment_proof", label: "Payment proof" },
  { value: "consent", label: "Consent" },
  { value: "psira_other", label: "PSIRA (other)" },
  { value: "other", label: "Other" },
];

function dateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export default function AcademyStudentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { token } = useAuth();
  const [student, setStudent] = useState<Student | null>(null);
  const [documents, setDocuments] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState("id_copy");
  const [uploading, setUploading] = useState(false);

  const [feeAmount, setFeeAmount] = useState("");
  const [feeMethod, setFeeMethod] = useState("EFT");
  const [feeReference, setFeeReference] = useState("");
  const [waiveNotes, setWaiveNotes] = useState("");
  const [feeSaving, setFeeSaving] = useState(false);

  const load = () => {
    if (!token || !id) return;
    setLoading(true);
    Promise.all([academyApi.getStudent(token, id), academyApi.listStudentDocuments(token, id)])
      .then(([s, d]) => {
        setStudent(s.student as Student);
        setDocuments((d.documents as DocRow[]) ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token, id]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !student) return;
    setSaving(true);
    setError(null);
    try {
      const { student: updated } = await academyApi.updateStudent(token, id, {
        firstName: student.firstName,
        lastName: student.lastName,
        middleName: student.middleName || null,
        preferredName: student.preferredName || null,
        idType: student.idType || null,
        idNumber: student.idNumber || null,
        dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth).toISOString() : null,
        gender: student.gender || null,
        nationality: student.nationality || null,
        phone: student.phone || null,
        alternatePhone: student.alternatePhone || null,
        email: student.email || null,
        addressLine1: student.addressLine1 || null,
        addressLine2: student.addressLine2 || null,
        city: student.city || null,
        province: student.province || null,
        postalCode: student.postalCode || null,
        nextOfKinName: student.nextOfKinName || null,
        nextOfKinPhone: student.nextOfKinPhone || null,
        psiraProfileReference: student.psiraProfileReference || null,
        psiraPreRegistrationStatus: student.psiraPreRegistrationStatus,
        status: student.status,
      });
      setStudent(updated as Student);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!token || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadAcademyStudentDocument(token, id, file, docType);
      e.target.value = "";
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const removeDoc = async (docId: string) => {
    if (!token || !confirm("Remove this document from the profile?")) return;
    setError(null);
    try {
      await academyApi.deleteStudentDocument(token, id, docId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  if (loading && !student) {
    return (
      <div className="p-6">
        <p className="text-sm text-black">Loading…</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="p-6">
        <p className="text-red-800">{error ?? "Student not found"}</p>
        <Link href="/academy/students" className="link mt-2 inline-block">
          Back to students
        </Link>
      </div>
    );
  }

  return (
    <div className="module-shell">
      <div>
        <Link href="/academy/students" className="text-sm font-semibold text-security-navy-800 hover:underline">
          ← Students
        </Link>
        <h1 className="page-title mt-1">
          {student.firstName} {student.lastName}
        </h1>
        <p className="font-mono text-sm text-black">{student.studentNumber}</p>
      </div>

      {error && (
        <div className="rounded-md border-2 border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="font-medium">Admin fee</h2>
        <p className="mt-1 max-w-2xl text-sm text-black leading-relaxed">
          Students must have the admin fee <strong>paid</strong> or <strong>waived</strong> before they can be enrolled
          in course runs.
        </p>
        {student && (
          <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-sm text-black">Status</dt>
              <dd className="font-medium capitalize">{student.adminFeeStatus ?? "unpaid"}</dd>
            </div>
            {student.adminFeePaidAt ? (
              <div>
                <dt className="text-xs text-sm text-black">Paid at</dt>
                <dd>{new Date(student.adminFeePaidAt).toLocaleString()}</dd>
              </div>
            ) : null}
            {student.adminFeeAmount ? (
              <div>
                <dt className="text-xs text-sm text-black">Amount</dt>
                <dd>{student.adminFeeAmount}</dd>
              </div>
            ) : null}
            {student.adminFeeMethod ? (
              <div>
                <dt className="text-xs text-sm text-black">Method</dt>
                <dd>{student.adminFeeMethod}</dd>
              </div>
            ) : null}
            {student.adminFeeReference ? (
              <div>
                <dt className="text-xs text-sm text-black">Reference</dt>
                <dd className="break-all">{student.adminFeeReference}</dd>
              </div>
            ) : null}
            {student.adminFeeNotes ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-sm text-black">Notes</dt>
                <dd>{student.adminFeeNotes}</dd>
              </div>
            ) : null}
          </dl>
        )}
        <div className="mt-4 grid gap-4 border-t border-neutral-200 pt-4 md:grid-cols-2">
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              setFeeSaving(true);
              setError(null);
              try {
                const { student: s } = await academyApi.recordStudentAdminFee(token, id, {
                  status: "paid",
                  amount: feeAmount.trim(),
                  method: feeMethod.trim() || null,
                  reference: feeReference.trim() || null,
                });
                setStudent(s as Student);
                setFeeAmount("");
                setFeeReference("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to record fee");
              } finally {
                setFeeSaving(false);
              }
            }}
          >
            <p className="text-xs font-medium text-sm text-black">Record payment</p>
            <input
              className="input-compact w-full"
              placeholder="Amount"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
            />
            <input
              className="input-compact w-full"
              placeholder="Method (e.g. EFT, cash)"
              value={feeMethod}
              onChange={(e) => setFeeMethod(e.target.value)}
            />
            <input
              className="input-compact w-full"
              placeholder="Reference (optional)"
              value={feeReference}
              onChange={(e) => setFeeReference(e.target.value)}
            />
            <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={feeSaving || !feeAmount.trim()}>
              {feeSaving ? "Saving…" : "Mark paid"}
            </button>
          </form>
          <form
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              setFeeSaving(true);
              setError(null);
              try {
                const { student: s } = await academyApi.recordStudentAdminFee(token, id, {
                  status: "waived",
                  notes: waiveNotes.trim(),
                });
                setStudent(s as Student);
                setWaiveNotes("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to waive");
              } finally {
                setFeeSaving(false);
              }
            }}
          >
            <p className="text-xs font-medium text-sm text-black">Waive fee</p>
            <textarea
              className="input-modern w-full min-h-[72px] rounded-security-lg py-2"
              placeholder="Reason (required)"
              value={waiveNotes}
              onChange={(e) => setWaiveNotes(e.target.value)}
            />
            <button type="submit" className="btn-secondary text-sm py-2 px-4" disabled={feeSaving || !waiveNotes.trim()}>
              {feeSaving ? "Saving…" : "Waive"}
            </button>
          </form>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className="btn-ghost text-xs py-1 px-2 min-h-8 text-sm text-black"
            disabled={feeSaving || !token}
            onClick={async () => {
              if (!token || !confirm("Reset admin fee to unpaid?")) return;
              setFeeSaving(true);
              setError(null);
              try {
                const { student: s } = await academyApi.recordStudentAdminFee(token, id, { status: "unpaid" });
                setStudent(s as Student);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to reset");
              } finally {
                setFeeSaving(false);
              }
            }}
          >
            Reset to unpaid (correction)
          </button>
        </div>
      </section>

      <form onSubmit={save} className="space-y-4 rounded-lg border border-neutral-200 p-4">
        <h2 className="font-medium">Profile</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name" value={student.firstName} onChange={(v) => setStudent({ ...student, firstName: v })} />
          <Field label="Last name" value={student.lastName} onChange={(v) => setStudent({ ...student, lastName: v })} />
          <Field label="Email" value={student.email ?? ""} onChange={(v) => setStudent({ ...student, email: v })} />
          <Field label="Phone" value={student.phone ?? ""} onChange={(v) => setStudent({ ...student, phone: v })} />
          <Field label="ID number" value={student.idNumber ?? ""} onChange={(v) => setStudent({ ...student, idNumber: v })} />
          <div>
            <label className="label py-0 text-xs">Date of birth</label>
            <input
              type="date"
              className="input-compact w-full"
              value={dateInput(student.dateOfBirth)}
              onChange={(e) =>
                setStudent({
                  ...student,
                  dateOfBirth: e.target.value ? new Date(e.target.value + "T12:00:00").toISOString() : null,
                })
              }
            />
          </div>
          <div>
            <label className="label py-0 text-xs">Status</label>
            <select
              className="input-compact min-h-10 w-full"
              value={student.status}
              onChange={(e) => setStudent({ ...student, status: e.target.value })}
            >
              {["prospect", "registered", "active", "completed", "inactive", "blocked"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label py-0 text-xs">PSIRA pre-registration</label>
            <select
              className="input-compact min-h-10 w-full"
              value={student.psiraPreRegistrationStatus}
              onChange={(e) => setStudent({ ...student, psiraPreRegistrationStatus: e.target.value })}
            >
              {["unknown", "not_required", "pending", "completed"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button type="submit" className="btn-primary text-sm py-2 px-4" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      <section className="rounded-lg border border-neutral-200 p-4">
        <h2 className="font-medium">Documents</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label py-0 text-xs">Type</label>
            <select
              className="input-compact min-h-10"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {docTypes.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label py-0 text-xs">File</label>
            <input
              type="file"
              className="block w-full text-sm text-black file:mr-4 file:rounded-security file:border-2 file:border-neutral-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:border-security-navy-400"
              disabled={uploading}
              onChange={onUpload}
            />
          </div>
        </div>
        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-black">No documents uploaded.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-medium">{d.documentType}</span> — {d.fileName}{" "}
                  <span className="text-xs text-black">({Math.round(d.sizeBytes / 1024)} KB)</span>
                </span>
                <button type="button" className="btn-ghost text-xs py-1 px-2 min-h-8 text-red-800" onClick={() => removeDoc(d.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label py-0 text-xs">{label}</label>
      <input className="input-compact w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
