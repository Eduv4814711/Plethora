"use client";

import { hasCapability } from "@/lib/permissions";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { DateInput } from "@/components/date-input";

export default function AcademyProfilePage() {
  const { token, user } = useAuth();
  const [form, setForm] = useState({
    trainingCentreName: "",
    tradingName: "",
    psiraTrainingProviderNumber: "",
    psiraBusinessRegistrationNumber: "",
    accreditationStatus: "pending",
    accreditationIssueDate: "",
    reAccreditationDueDate: "",
    province: "",
    city: "",
    physicalAddress: "",
    postalAddress: "",
    contactPerson: "",
    phoneNumber: "",
    landline: "",
    email: "",
    verificationReference: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const canEdit = Boolean(user && hasCapability(user, "/academy", "edit"));
  const formReadOnly = !canEdit || !isEditing || saving;
  const fieldLabelClass = "text-xs font-medium text-[#35383f]";
  const fieldClass =
    "h-10 w-full rounded-lg border border-[#dde1e6] bg-white px-3 text-sm text-security-navy-900 placeholder:text-[#8d8f95] outline-none transition focus:border-[#ff9b4a] focus:ring-2 focus:ring-[#ff9b4a]/20 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]";

  const load = () => {
    if (!token) return;
    academyApi
      .getProfile(token)
      .then((res) => {
        const p = (res.profile ?? {}) as Record<string, unknown>;
        setForm((f) => ({
          ...f,
          trainingCentreName: String(p.trainingCentreName ?? ""),
          tradingName: String(p.tradingName ?? ""),
          psiraTrainingProviderNumber: String(p.psiraTrainingProviderNumber ?? ""),
          psiraBusinessRegistrationNumber: String(p.psiraBusinessRegistrationNumber ?? ""),
          accreditationStatus: String(p.accreditationStatus ?? "pending"),
          accreditationIssueDate: String(p.accreditationIssueDate ?? "").slice(0, 10),
          reAccreditationDueDate: String(p.reAccreditationDueDate ?? "").slice(0, 10),
          province: String(p.province ?? ""),
          city: String(p.city ?? ""),
          physicalAddress: String(p.physicalAddress ?? ""),
          postalAddress: String(p.postalAddress ?? ""),
          contactPerson: String(p.contactPerson ?? ""),
          phoneNumber: String(p.phoneNumber ?? ""),
          landline: String(p.landline ?? ""),
          email: String(p.email ?? ""),
          verificationReference: String(p.verificationReference ?? ""),
          notes: String(p.notes ?? ""),
        }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load profile"));
  };

  useEffect(load, [token]);
  useEffect(() => {
    if (!canEdit) setIsEditing(false);
  }, [canEdit]);
  useEffect(() => {
    if (!saveMessage) return;
    const timer = window.setTimeout(() => setSaveMessage(null), 10000);
    return () => window.clearTimeout(timer);
  }, [saveMessage]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canEdit || !isEditing) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      await academyApi.updateProfile(token, form);
      setSaveMessage("Profile saved successfully.");
      setIsEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save profile");
      setSaveMessage(null);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof typeof form, value: string) => {
    if (saveMessage) setSaveMessage(null);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-security-navy-900">Profile</h1>
          <p className="text-sm text-[#6e7480]">Manage your training provider and organisation information.</p>
        </div>
        {canEdit && isEditing && (
          <button
            type="submit"
            form="academy-profile-form"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#ff7a00] px-4 text-sm font-semibold text-white shadow-security-card transition hover:bg-[#e86f00] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h14v14H5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 5v5h8V5M9 19h6" />
            </svg>
            {saving ? "Saving..." : "Save profile"}
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-security-navy-200 bg-security-navy-50/50 px-3 py-2 text-sm">
          Read-only: academy edit access is required to update the profile.
        </div>
      )}

      {error && <div className="rounded-lg border border-error/30 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {saveMessage && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-security-emerald-300/80 bg-security-emerald-50 px-3 py-2 text-sm text-security-emerald-700">
          <span>{saveMessage}</span>
          {canEdit && !isEditing && (
            <button
              type="button"
              onClick={() => {
                setSaveMessage(null);
                setIsEditing(true);
              }}
              className="inline-flex h-8 items-center rounded-md border border-security-emerald-300 bg-white px-3 text-xs font-semibold text-security-emerald-700 transition hover:bg-security-emerald-100"
            >
              Edit profile
            </button>
          )}
        </div>
      )}

      <form
        id="academy-profile-form"
        onSubmit={submit}
        className="space-y-5 rounded-2xl border border-[#ebedf0] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] md:p-6"
      >
        <div className="flex items-center gap-3 border-b border-[#eceef2] pb-4">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#fff1e5] text-[#ff7a00]">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 20h16M5 20V7l7-3 7 3v13M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
              />
            </svg>
          </span>
          <h2 className="text-base font-semibold text-security-navy-900">Organisation details</h2>
        </div>

        {isEditing || !canEdit ? (
          <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Training centre name *</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter training centre name"
              value={form.trainingCentreName}
              disabled={formReadOnly}
              onChange={(e) => handleChange("trainingCentreName", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Trading name *</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter trading name"
              value={form.tradingName}
              disabled={formReadOnly}
              onChange={(e) => handleChange("tradingName", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>PSIRA training provider number *</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter PSIRA provider number"
              value={form.psiraTrainingProviderNumber}
              disabled={formReadOnly}
              onChange={(e) => handleChange("psiraTrainingProviderNumber", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>PSIRA business registration number *</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter PSIRA registration number"
              value={form.psiraBusinessRegistrationNumber}
              disabled={formReadOnly}
              onChange={(e) => handleChange("psiraBusinessRegistrationNumber", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Accreditation status *</span>
            <select
              className={fieldClass}
              disabled={formReadOnly}
              value={form.accreditationStatus}
              onChange={(e) => handleChange("accreditationStatus", e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Accreditation issue date</span>
            <DateInput
              value={form.accreditationIssueDate}
              onChange={(v) => handleChange("accreditationIssueDate", v)}
              disabled={formReadOnly}
              className="input-modern"
              ariaLabel="Accreditation issue date"
              showToday
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Re-accreditation due date</span>
            <DateInput
              value={form.reAccreditationDueDate}
              onChange={(v) => handleChange("reAccreditationDueDate", v)}
              disabled={formReadOnly}
              className="input-modern"
              ariaLabel="Re-accreditation due date"
              showToday
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Province</span>
            <select
              className={fieldClass}
              value={form.province}
              disabled={formReadOnly}
              onChange={(e) => handleChange("province", e.target.value)}
            >
              <option value="">Select province</option>
              <option value="Eastern Cape">Eastern Cape</option>
              <option value="Free State">Free State</option>
              <option value="Gauteng">Gauteng</option>
              <option value="KwaZulu-Natal">KwaZulu-Natal</option>
              <option value="Limpopo">Limpopo</option>
              <option value="Mpumalanga">Mpumalanga</option>
              <option value="Northern Cape">Northern Cape</option>
              <option value="North West">North West</option>
              <option value="Western Cape">Western Cape</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>City</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter city"
              value={form.city}
              disabled={formReadOnly}
              onChange={(e) => handleChange("city", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Phone number</span>
            <div className="flex h-10 items-center rounded-lg border border-[#dde1e6] bg-white pl-2 pr-1">
              <select
                className="h-full min-h-0 w-[84px] border-0 bg-transparent text-sm text-security-navy-900 outline-none"
                disabled={formReadOnly}
                defaultValue="+27"
              >
                <option value="+27">+27</option>
              </select>
              <input
                className="h-full w-full border-0 bg-transparent px-2 text-sm text-security-navy-900 placeholder:text-[#8d8f95] outline-none"
                type="text"
                placeholder="Enter phone number"
                value={form.phoneNumber}
                disabled={formReadOnly}
                onChange={(e) => handleChange("phoneNumber", e.target.value)}
              />
            </div>
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Physical address</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter physical address"
              value={form.physicalAddress}
              disabled={formReadOnly}
              onChange={(e) => handleChange("physicalAddress", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Email</span>
            <div className="relative">
              <input
                className={`${fieldClass} pl-9`}
                type="email"
                placeholder="Enter email address"
                value={form.email}
                disabled={formReadOnly}
                onChange={(e) => handleChange("email", e.target.value)}
              />
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#a3a7ae]" aria-hidden>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7l9 6 9-6M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
                </svg>
              </span>
            </div>
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Contact person</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter contact person"
              value={form.contactPerson}
              disabled={formReadOnly}
              onChange={(e) => handleChange("contactPerson", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Landline</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter landline"
              value={form.landline}
              disabled={formReadOnly}
              onChange={(e) => handleChange("landline", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Verification reference</span>
            <input
              className={fieldClass}
              type="text"
              placeholder="Enter verification reference"
              value={form.verificationReference}
              disabled={formReadOnly}
              onChange={(e) => handleChange("verificationReference", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className={fieldLabelClass}>Note Notes</span>
            <textarea
              className="min-h-[110px] w-full resize-y rounded-lg border border-[#dde1e6] bg-white px-3 py-2.5 text-sm text-security-navy-900 placeholder:text-[#8d8f95] outline-none transition focus:border-[#ff9b4a] focus:ring-2 focus:ring-[#ff9b4a]/20 disabled:cursor-not-allowed disabled:bg-[#f7f8fa]"
              placeholder="Enter any additional notes"
              value={form.notes}
              disabled={formReadOnly}
              onChange={(e) => handleChange("notes", e.target.value)}
            />
          </label>
          </div>
        ) : (
          <div
            className={`rounded-lg border border-[#eceef2] bg-[#fafbfc] px-4 py-3 ${
              canEdit ? "cursor-pointer transition hover:border-[#d9dde3] hover:bg-[#f7f9fc]" : ""
            }`}
            onClick={() => {
              if (!canEdit) return;
              setError(null);
              setSaveMessage(null);
              setIsEditing(true);
            }}
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onKeyDown={(e) => {
              if (!canEdit) return;
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              setError(null);
              setSaveMessage(null);
              setIsEditing(true);
            }}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-[#6e7480]">Training centre name</p>
            <p className="mt-1 text-sm font-semibold text-security-navy-900">{form.trainingCentreName || "—"}</p>
            {canEdit && <p className="mt-1 text-xs text-[#6e7480]">Click to edit profile</p>}
          </div>
        )}
      </form>
    </div>
  );
}
