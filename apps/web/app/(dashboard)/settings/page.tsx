"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { uploadLogo, listUsers, createUser, updateUser, deleteUser, type UserListItem, type UserRole } from "@/lib/api";
import { clsx } from "clsx";

type Tab = "profile" | "business" | "settings" | "users";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  operations_manager: "Operations Manager",
  hr_payroll: "HR & Payroll",
  supervisor: "Supervisor",
};

export default function SettingsPage() {
  const { user, token } = useAuth();
  const { settings, loading, update, error } = useSettings();
  const isAdmin = user?.role === "admin";
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; adminOnly?: boolean }[] = [
    { id: "profile", label: "Profile" },
    { id: "business", label: "Business Details" },
    { id: "settings", label: "Business Settings" },
    { id: "users", label: "Users", adminOnly: true },
  ];

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-10 h-10 rounded-sm bg-neutral-100 dark:bg-neutral-900/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-800 dark:text-white mb-6">
        Settings
      </h1>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {error}
        </div>
      )}

      {!isAdmin && activeTab !== "profile" && (
        <div className="mb-4 p-3 text-sm text-neutral-700 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/20 rounded-sm border border-black dark:border-white">
          Only administrators can edit business details and settings.
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-black dark:border-white overflow-x-auto">
        {tabs
          .filter((t) => !t.adminOnly || isAdmin)
          .map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "px-4 py-2.5 text-sm font-medium rounded-t-sm transition-colors",
              activeTab === tab.id
                ? "bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-black dark:border-white border-b-transparent -mb-px"
                : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-neutral-800 rounded-sm border border-black dark:border-white p-6">
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
        {activeTab === "users" && isAdmin && token && (
          <UsersSection token={token} currentUserId={user?.id} />
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
      <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Logo</label>
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="w-24 h-24 rounded-sm border-2 border-dashed border-black dark:border-white flex items-center justify-center overflow-hidden bg-neutral-50 dark:bg-neutral-800/50 shrink-0">
          {previewUrl ? (
            <img src={previewUrl} alt="Logo" className="w-full h-full object-contain" />
          ) : (
            <span className="text-3xl text-neutral-400 dark:text-neutral-500">?</span>
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
                  className="ml-2 px-3 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-sm transition-colors"
                >
                  Remove
                </button>
              )}
            </>
          )}
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-2">
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
      <h3 className="font-semibold text-neutral-800 dark:text-white mb-4">Profile</h3>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-neutral-500 dark:text-neutral-400">Name</dt>
          <dd className="text-neutral-900 dark:text-white">{user?.name}</dd>
        </div>
        <div>
          <dt className="text-neutral-500 dark:text-neutral-400">Email</dt>
          <dd className="text-neutral-900 dark:text-white">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-neutral-500 dark:text-neutral-400">Role</dt>
          <dd className="text-neutral-900 dark:text-white">{user?.role}</dd>
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
      <h3 className="font-semibold text-neutral-800 dark:text-white mb-4">Business Details</h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Configure your company information. This is used across the system (invoices, reports, etc.).
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Company Name</label>
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Legal Name</label>
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
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Registration Number</label>
            <input
              type="text"
              value={form.registrationNumber}
              onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
              className="input-modern"
              readOnly={readOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Tax Number</label>
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Address</label>
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
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Phone</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="input-modern"
              readOnly={readOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Email</label>
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Website</label>
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
    employeeIdPrefix: "EMP",
  });

  useEffect(() => {
    if (settings?.settings) {
      const s = settings.settings;
      setForm({
        currency: s.currency ?? "ZAR",
        dateFormat: s.dateFormat ?? "DD/MM/YYYY",
        timezone: s.timezone ?? "Africa/Johannesburg",
        payrollPeriod: s.payrollPeriod ?? "monthly",
        employeeIdPrefix: s.employeeIdPrefix ?? "EMP",
      });
    }
  }, [settings?.settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div>
      <h3 className="font-semibold text-neutral-800 dark:text-white mb-4">Business Settings</h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Configure defaults used for payroll, dates, and reporting.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Currency</label>
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Date Format</label>
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Timezone</label>
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Payroll Period</label>
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
        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Employee ID Prefix</label>
          <input
            type="text"
            value={form.employeeIdPrefix}
            onChange={(e) => setForm((f) => ({ ...f, employeeIdPrefix: e.target.value.toUpperCase() }))}
            className="input-modern"
            placeholder="EMP"
            maxLength={20}
            disabled={readOnly}
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Prefix for auto-generated employee IDs (e.g. EMP-0001, STAFF-0001)
          </p>
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

function UsersSection({ token, currentUserId }: { token: string; currentUserId?: string }) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "supervisor" as UserRole,
  });
  const [submitting, setSubmitting] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "supervisor" as UserRole,
  });

  const fetchUsers = useCallback(async () => {
    try {
      setError(null);
      const { data } = await listUsers(token);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createUser(token, addForm);
      setAddForm({ name: "", email: "", password: "", role: "supervisor" });
      setShowAddForm(false);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Partial<{ name: string; email: string; password: string; role: UserRole }> = {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
      };
      if (editForm.password) payload.password = editForm.password;
      await updateUser(token, editingUserId, payload);
      setEditingUserId(null);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteUser(token, userId);
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (u: UserListItem) => {
    setEditingUserId(u.id);
    setEditForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[120px]">
        <div className="w-8 h-8 rounded-sm bg-neutral-100 dark:bg-neutral-900/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold text-neutral-800 dark:text-white mb-4">Users & Roles</h3>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
        Add, edit, and delete users. Assign role-based permissions. Only admins can manage users.
      </p>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {error}
        </div>
      )}

      <div className="space-y-4 max-w-2xl">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {users.length} user{users.length !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="btn-primary text-sm"
          >
            {showAddForm ? "Cancel" : "Add User"}
          </button>
        </div>

        {showAddForm && (
          <form
            onSubmit={handleAddUser}
            className="p-4 rounded-sm border border-black dark:border-white bg-neutral-50 dark:bg-neutral-800/50 space-y-4"
          >
            <h4 className="font-medium text-neutral-800 dark:text-white">New User</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Name</label>
                <input
                  type="text"
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  className="input-modern"
                  placeholder="Jane Doe"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                  className="input-modern"
                  placeholder="jane@company.com"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Password</label>
                <input
                  type="password"
                  value={addForm.password}
                  onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))}
                  className="input-modern"
                  placeholder="Min 8 characters"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Role</label>
                <select
                  value={addForm.role}
                  onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                  className="input-modern"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Adding..." : "Add User"}
            </button>
          </form>
        )}

        <div className="rounded-sm border border-black dark:border-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-black dark:border-white">
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Name</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Email</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Role</th>
                <th className="text-right py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <React.Fragment key={u.id}>
                  <tr
                    key={u.id}
                    className="border-b border-black dark:border-white last:border-0 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30"
                  >
                    <td className="py-3 px-4 text-neutral-900 dark:text-white">
                      {editingUserId === u.id ? null : (
                        <>
                          {u.name}
                          {u.id === currentUserId && (
                            <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">(you)</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400">
                      {editingUserId === u.id ? null : u.email}
                    </td>
                    <td className="py-3 px-4 text-neutral-700 dark:text-neutral-300">
                      {editingUserId === u.id ? null : ROLE_LABELS[u.role]}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {editingUserId === u.id ? (
                        <button
                          type="button"
                          onClick={() => setEditingUserId(null)}
                          disabled={submitting}
                          className="text-xs text-neutral-600 dark:text-neutral-400 hover:underline"
                        >
                          Cancel
                        </button>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {u.id !== currentUserId && (
                            <>
                              <button
                                type="button"
                                onClick={() => startEditing(u)}
                                disabled={submitting}
                                className="text-xs text-neutral-600 dark:text-neutral-400 hover:underline"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u.id, u.name)}
                                disabled={submitting}
                                className="text-xs text-red-600 dark:text-red-400 hover:underline"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {editingUserId === u.id && (
                    <tr className="border-b border-black dark:border-white bg-neutral-50 dark:bg-neutral-800/50">
                      <td colSpan={4} className="py-4 px-4">
                        <form onSubmit={handleEditUser} className="space-y-4">
                          <h4 className="font-medium text-neutral-800 dark:text-white">Edit User</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Name</label>
                              <input
                                type="text"
                                value={editForm.name}
                                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                className="input-modern"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Email</label>
                              <input
                                type="email"
                                value={editForm.email}
                                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                                className="input-modern"
                                required
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Password</label>
                              <input
                                type="password"
                                value={editForm.password}
                                onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))}
                                className="input-modern"
                                placeholder="Leave blank to keep current"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Role</label>
                              <select
                                value={editForm.role}
                                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                                className="input-modern"
                              >
                                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                                  <option key={r} value={r}>
                                    {ROLE_LABELS[r]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="submit" disabled={submitting} className="btn-primary text-sm">
                              {submitting ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingUserId(null)}
                              disabled={submitting}
                              className="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700/50 rounded-sm"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
