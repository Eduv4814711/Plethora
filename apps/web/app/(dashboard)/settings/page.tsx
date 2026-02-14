"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { uploadLogo } from "@/lib/api";
import { clsx } from "clsx";

type Tab = "profile" | "business" | "settings" | "theme";

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings, loading, update, error } = useSettings();
  const isAdmin = user?.role === "admin";
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "business", label: "Business Details" },
    { id: "settings", label: "Business Settings" },
    { id: "theme", label: "Theme" },
  ];

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">
        Settings
      </h1>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800/50">
          {error}
        </div>
      )}

      {!isAdmin && activeTab !== "profile" && (
        <div className="mb-4 p-3 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/50">
          Only administrators can edit business details, settings, and theme.
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors",
              activeTab === tab.id
                ? "bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700 border-b-transparent -mb-px"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
        {activeTab === "profile" && (
          <ProfileSection user={user} />
        )}
        {activeTab === "business" && (
          <BusinessDetailsSection
            readOnly={!isAdmin}
            settings={settings}
            saving={saving}
            saveError={saveError}
            onSave={async (data) => {
              setSaving(true);
              setSaveError(null);
              try {
                const { name, ...details } = data;
                await update({ name, businessDetails: details });
              } catch (err) {
                setSaveError(err instanceof Error ? err.message : "Failed to save");
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
        {activeTab === "settings" && (
          <BusinessSettingsSection
            readOnly={!isAdmin}
            settings={settings}
            saving={saving}
            saveError={saveError}
            onSave={async (data) => {
              setSaving(true);
              setSaveError(null);
              try {
                await update({ businessSettings: data });
              } catch (err) {
                setSaveError(err instanceof Error ? err.message : "Failed to save");
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
        {activeTab === "theme" && (
          <ThemeSection
            readOnly={!isAdmin}
            settings={settings}
            saving={saving}
            saveError={saveError}
            onSave={async (data) => {
              setSaving(true);
              setSaveError(null);
              try {
                await update({ theme: data });
              } catch (err) {
                setSaveError(err instanceof Error ? err.message : "Failed to save");
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function LogoUpload({
  logoUrl,
  onLogoChange,
  readOnly,
}: {
  logoUrl: string;
  onLogoChange: (url: string) => void;
  readOnly?: boolean;
}) {
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token || readOnly) return;

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
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Logo</label>
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-600 flex items-center justify-center overflow-hidden bg-slate-50 dark:bg-slate-800/50 shrink-0">
          {previewUrl ? (
            <img src={previewUrl} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span className="text-3xl text-slate-400 dark:text-slate-500">?</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {!readOnly && (
            <>
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
                  className="ml-2 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  Remove
                </button>
              )}
            </>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            JPEG, PNG, GIF or WebP. Max 2MB.
          </p>
          {uploadError && (
            <p className="text-sm text-red-600 dark:text-red-400 mt-1">{uploadError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileSection({ user }: { user: { name?: string; email?: string; role?: string } | null }) {
  return (
    <div>
      <h3 className="font-semibold text-slate-800 dark:text-white mb-4">Profile</h3>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Name</dt>
          <dd className="text-slate-900 dark:text-white">{user?.name}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Email</dt>
          <dd className="text-slate-900 dark:text-white">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Role</dt>
          <dd className="text-slate-900 dark:text-white">{user?.role}</dd>
        </div>
      </dl>
    </div>
  );
}

function BusinessDetailsSection({
  settings,
  saving,
  saveError,
  onSave,
  readOnly,
}: {
  settings: ReturnType<typeof useSettings>["settings"];
  saving: boolean;
  saveError: string | null;
  onSave: (data: Record<string, string>) => Promise<void>;
  readOnly?: boolean;
}) {
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
  });

  useEffect(() => {
    if (settings) {
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
      });
    }
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div>
      <h3 className="font-semibold text-slate-800 dark:text-white mb-4">Business Details</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Configure your company information. This is used across the system (invoices, reports, etc.).
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Company Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input-modern"
            placeholder="Quick Bopha Security"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Legal Name</label>
          <input
            type="text"
            value={form.legalName}
            onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
            className="input-modern"
            placeholder="Quick Bopha Security (Pty) Ltd"
            readOnly={readOnly}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Registration Number</label>
            <input
              type="text"
              value={form.registrationNumber}
              onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
              className="input-modern"
              readOnly={readOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tax Number</label>
            <input
              type="text"
              value={form.taxNumber}
              onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))}
              className="input-modern"
              readOnly={readOnly}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Address</label>
          <textarea
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className="input-modern min-h-[80px]"
            rows={3}
            readOnly={readOnly}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phone</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="input-modern"
              readOnly={readOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="input-modern"
              readOnly={readOnly}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Website</label>
          <input
            type="url"
            value={form.website}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            className="input-modern"
            placeholder="https://"
            readOnly={readOnly}
          />
        </div>
        <LogoUpload
          logoUrl={form.logoUrl}
          onLogoChange={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
          readOnly={readOnly}
        />
        {saveError && (
          <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
        )}
        {!readOnly && (
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save Business Details"}
          </button>
        )}
      </form>
    </div>
  );
}

function BusinessSettingsSection({
  settings,
  saving,
  saveError,
  onSave,
  readOnly,
}: {
  settings: ReturnType<typeof useSettings>["settings"];
  saving: boolean;
  saveError: string | null;
  onSave: (data: Record<string, string>) => Promise<void>;
  readOnly?: boolean;
}) {
  const bizSettings = settings?.settings ?? {};
  const [form, setForm] = useState({
    currency: "ZAR",
    dateFormat: "DD/MM/YYYY",
    timezone: "Africa/Johannesburg",
    payrollPeriod: "monthly",
  });

  useEffect(() => {
    if (settings?.settings) {
      const s = settings.settings;
      setForm({
        currency: s.currency ?? "ZAR",
        dateFormat: s.dateFormat ?? "DD/MM/YYYY",
        timezone: s.timezone ?? "Africa/Johannesburg",
        payrollPeriod: s.payrollPeriod ?? "monthly",
      });
    }
  }, [settings?.settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div>
      <h3 className="font-semibold text-slate-800 dark:text-white mb-4">Business Settings</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Configure defaults used for payroll, dates, and reporting.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Currency</label>
          <select
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            className="input-modern"
            disabled={readOnly}
          >
            <option value="ZAR">ZAR (South African Rand)</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date Format</label>
          <select
            value={form.dateFormat}
            onChange={(e) => setForm((f) => ({ ...f, dateFormat: e.target.value }))}
            className="input-modern"
            disabled={readOnly}
          >
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Timezone</label>
          <input
            type="text"
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            className="input-modern"
            placeholder="Africa/Johannesburg"
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Payroll Period</label>
          <select
            value={form.payrollPeriod}
            onChange={(e) => setForm((f) => ({ ...f, payrollPeriod: e.target.value }))}
            className="input-modern"
            disabled={readOnly}
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        {saveError && (
          <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
        )}
        {!readOnly && (
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save Business Settings"}
          </button>
        )}
      </form>
    </div>
  );
}

function ThemeSection({
  settings,
  saving,
  saveError,
  onSave,
  readOnly,
}: {
  settings: ReturnType<typeof useSettings>["settings"];
  saving: boolean;
  saveError: string | null;
  onSave: (data: Record<string, string>) => Promise<void>;
  readOnly?: boolean;
}) {
  const theme = settings?.theme ?? {};
  const [form, setForm] = useState({
    primaryColor: "#6366f1",
    accentColor: "#6366f1",
    mode: "system",
  });

  useEffect(() => {
    if (settings?.theme) {
      const t = settings.theme;
      setForm({
        primaryColor: t.primaryColor ?? "#6366f1",
        accentColor: t.accentColor ?? "#6366f1",
        mode: t.mode ?? "system",
      });
    }
  }, [settings?.theme]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div>
      <h3 className="font-semibold text-slate-800 dark:text-white mb-4">Theme</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        Customize the appearance of the application. Changes apply globally.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Color Mode</label>
          <select
            value={form.mode}
            onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))}
            className="input-modern"
            disabled={readOnly}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System (follow device)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Primary Color</label>
          <div className="flex gap-3 items-center">
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              className="w-12 h-12 rounded-lg cursor-pointer border border-slate-200 dark:border-slate-600"
              disabled={readOnly}
            />
            <input
              type="text"
              value={form.primaryColor}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              className="input-modern flex-1 font-mono text-sm"
              readOnly={readOnly}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Accent Color</label>
          <div className="flex gap-3 items-center">
            <input
              type="color"
              value={form.accentColor}
              onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
              className="w-12 h-12 rounded-lg cursor-pointer border border-slate-200 dark:border-slate-600"
              disabled={readOnly}
            />
            <input
              type="text"
              value={form.accentColor}
              onChange={(e) => setForm((f) => ({ ...f, accentColor: e.target.value }))}
              className="input-modern flex-1 font-mono text-sm"
              readOnly={readOnly}
            />
          </div>
        </div>
        {saveError && (
          <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
        )}
        {!readOnly && (
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save Theme"}
          </button>
        )}
      </form>
    </div>
  );
}
