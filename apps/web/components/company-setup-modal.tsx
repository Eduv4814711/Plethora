"use client";

import React, { useState, useEffect, useRef } from "react";
import type { CompanySettings } from "@/lib/api";
import { uploadLogo } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type CompanySetupModalProps = {
  settings: CompanySettings | null;
  onSave: (data: {
    name: string;
    businessDetails: Record<string, string>;
    businessSettings: {
      currency: string;
      dateFormat: string;
      timezone: string;
      payrollPeriod: "weekly" | "biweekly" | "monthly";
      employeeIdPrefix: string;
    };
  }) => Promise<void>;
  isOwner: boolean;
  onLogout: () => void;
};

export function CompanySetupModal({
  settings,
  onSave,
  isOwner,
  onLogout,
}: CompanySetupModalProps) {
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    registrationNumber: "",
    taxNumber: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    logoUrl: "",
    fax: "",
    psiraRegistration: "",
    uifReference: "",
    currency: "ZAR",
    dateFormat: "DD/MM/YYYY",
    timezone: "Africa/Johannesburg",
    payrollPeriod: "monthly",
    employeeIdPrefix: "EMP",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameInvalid = !form.name.trim() || form.name.trim() === "My Company";

  useEffect(() => {
    if (settings) {
      const s = settings.settings ?? {};
      setForm({
        name: settings.name ?? "",
        legalName: settings.legalName ?? "",
        registrationNumber: settings.registrationNumber ?? "",
        taxNumber: settings.taxNumber ?? "",
        address: settings.address ?? "",
        phone: settings.phone ?? "",
        email: settings.email ?? "",
        website: settings.website ?? "",
        logoUrl: settings.logoUrl ?? "",
        fax: settings.fax ?? "",
        psiraRegistration: settings.psiraRegistration ?? "",
        uifReference: settings.uifReference ?? "",
        currency: s.currency ?? "ZAR",
        dateFormat: s.dateFormat ?? "DD/MM/YYYY",
        timezone: s.timezone ?? "Africa/Johannesburg",
        payrollPeriod: s.payrollPeriod ?? "monthly",
        employeeIdPrefix: s.employeeIdPrefix ?? "EMP",
      });
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    setSaving(true);
    setError(null);
    try {
      const { name, legalName, registrationNumber, taxNumber, address, phone, email, website, logoUrl, fax, psiraRegistration, uifReference, currency, dateFormat, timezone, payrollPeriod, employeeIdPrefix } = form;
      await onSave({
        name,
        businessDetails: {
          legalName,
          registrationNumber,
          taxNumber,
          address,
          phone,
          email,
          website,
          logoUrl,
          fax,
          psiraRegistration,
          uifReference,
        },
        businessSettings: {
          currency,
          dateFormat,
          timezone,
          payrollPeriod: payrollPeriod as "weekly" | "biweekly" | "monthly",
          employeeIdPrefix,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
        <div className="card-elevated w-full max-w-md p-8 text-center">
          <h2 className="text-xl font-bold text-security-navy-900 mb-2">
            Company Setup Required
          </h2>
          <p className="text-sm text-security-navy-900 mb-6">
            Company setup is required. Please contact the company owner to configure company details.
          </p>
          <button
            type="button"
            onClick={onLogout}
            className="btn-primary"
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/20">
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="max-w-2xl mx-auto my-4 sm:my-8 card-elevated flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-4rem)]">
          {/* Sticky header - light blue accent */}
          <div className="shrink-0 p-6 pb-4 border-b-2 border-security-navy-100 bg-wireframe-accent rounded-t-[10px]">
            <h2 className="text-xl font-bold text-security-navy-900 mb-2">
              Company Setup Required
            </h2>
            <p className="text-sm text-security-navy-900 mb-4">
              Enter your company name below, then fill in the rest. This information is required for the system to function correctly.
            </p>
            <div className="p-4 rounded-[10px] bg-white border-2 border-security-navy-100">
              <label className="block text-sm font-medium text-security-navy-900 mb-1">Company Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="input-modern"
                placeholder="Enter your company name (e.g. Quick Bopha Security)"
                required
              />
              {nameInvalid && (
                <p className="text-sm text-security-navy-900 mt-1">
                  Change from &quot;My Company&quot; to your actual company name to enable Save.
                </p>
              )}
            </div>
          </div>

          {/* Scrollable form body */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div>
            <h3 className="font-semibold text-security-navy-900 mb-4">Business Details</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Legal Name</label>
                <input
                  type="text"
                  value={form.legalName}
                  onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
                  className="input-modern"
                  placeholder="Quick Bopha Security (Pty) Ltd"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-security-navy-900 mb-1">PSIRA Registration</label>
                  <input
                    type="text"
                    value={form.psiraRegistration}
                    onChange={(e) => setForm((f) => ({ ...f, psiraRegistration: e.target.value }))}
                    className="input-modern"
                    placeholder="Company PSIRA number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-security-navy-900 mb-1">Company Registration</label>
                  <input
                    type="text"
                    value={form.registrationNumber}
                    onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
                    className="input-modern"
                    placeholder="Registration number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-security-navy-900 mb-1">Tax Number</label>
                  <input
                    type="text"
                    value={form.taxNumber}
                    onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))}
                    className="input-modern"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-security-navy-900 mb-1">UIF Reference</label>
                  <input
                    type="text"
                    value={form.uifReference}
                    onChange={(e) => setForm((f) => ({ ...f, uifReference: e.target.value }))}
                    className="input-modern"
                    placeholder="UIF reference number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-security-navy-900 mb-1">Telephone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="input-modern"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-security-navy-900 mb-1">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="input-modern"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Address</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="input-modern min-h-[80px]"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Website</label>
                <input
                  type="url"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                  className="input-modern"
                  placeholder="https://"
                />
              </div>
              <LogoUploadInline
                logoUrl={form.logoUrl}
                onLogoChange={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
              />
            </div>
          </div>

          <div className="border-t-2 border-security-navy-100 pt-6">
            <h3 className="font-semibold text-security-navy-900 mb-4">Business Settings</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  className="input-modern"
                >
                  <option value="ZAR">ZAR (South African Rand)</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Date Format</label>
                <select
                  value={form.dateFormat}
                  onChange={(e) => setForm((f) => ({ ...f, dateFormat: e.target.value }))}
                  className="input-modern"
                >
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Timezone</label>
                <input
                  type="text"
                  value={form.timezone}
                  onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                  className="input-modern"
                  placeholder="Africa/Johannesburg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Payroll Period</label>
                <select
                  value={form.payrollPeriod}
                  onChange={(e) => setForm((f) => ({ ...f, payrollPeriod: e.target.value }))}
                  className="input-modern"
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-security-navy-900 mb-1">Team Member ID Prefix</label>
                <input
                  type="text"
                  value={form.employeeIdPrefix}
                  onChange={(e) => setForm((f) => ({ ...f, employeeIdPrefix: e.target.value.toUpperCase() }))}
                  className="input-modern"
                  placeholder="EMP"
                  maxLength={20}
                />
              </div>
            </div>
          </div>
          </div>

          {/* Sticky footer */}
          <div className="shrink-0 p-6 pt-4 border-t-2 border-security-navy-100 bg-white rounded-b-[10px]">
            {error && (
              <p className="text-sm text-security-navy-900 mb-3">{error}</p>
            )}
            {nameInvalid && (
              <p className="text-sm text-security-navy-900 mb-3">
                Save is disabled until you change the Company Name above.
              </p>
            )}
            <button
              type="submit"
              disabled={saving || nameInvalid}
              className="btn-primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save & Continue"}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}

function LogoUploadInline({
  logoUrl,
  onLogoChange,
}: {
  logoUrl: string;
  onLogoChange: (url: string) => void;
}) {
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowed.includes(file.type)) {
      setUploadError("Please select a JPEG, PNG, GIF, or WebP image (max 2MB)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError("Image must be under 2MB");
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const { url } = await uploadLogo(token, file);
      onLogoChange(url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const previewUrl = logoUrl || undefined;

  return (
    <div>
      <label className="block text-sm font-medium text-security-navy-900 mb-2">Logo</label>
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="w-24 h-24 rounded-[10px] border-2 border-security-navy-100 flex items-center justify-center overflow-hidden bg-white shrink-0">
          {previewUrl ? (
            <img src={previewUrl} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span className="text-3xl text-security-navy-900">?</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleFileChange}
            disabled={uploading}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-primary text-sm"
          >
            {uploading ? "Uploading..." : "Upload image"}
          </button>
          {logoUrl && (
            <button
              type="button"
              onClick={() => onLogoChange("")}
              disabled={uploading}
              className="ml-2 px-3 py-2 text-sm font-medium text-security-navy-900 hover:bg-security-navy-50 border-2 border-transparent hover:border-security-navy-300 rounded-[10px] transition-colors"
            >
              Remove
            </button>
          )}
          <p className="text-xs text-security-navy-900 mt-2">
            JPEG, PNG, GIF or WebP. Max 2MB.
          </p>
          {uploadError && (
            <p className="text-sm text-security-navy-900 mt-1">{uploadError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
