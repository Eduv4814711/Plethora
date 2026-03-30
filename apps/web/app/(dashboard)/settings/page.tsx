"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { listUsers, createUser, updateUser, deleteUser, factoryReset, FACTORY_RESET_MODULES, authFetch, type UserListItem, type UserRole, type FactoryResetModuleId } from "@/lib/api";
import {
  MODULE_ASSIGN_OPTIONS,
  normalizeUserModuleAccess,
  defaultModulesForRole,
  isFullAdmin,
} from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import { clsx } from "clsx";

type Tab = "profile" | "business" | "settings" | "users" | "migrate" | "factory_reset";

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  operations_manager: "Operations Manager",
  hr_payroll: "HR & Payroll",
  supervisor: "Supervisor",
  controller: "Controller",
};

/** Shown when "Assign Role" is selected (add/edit user). */
const STAFF_ROLES: UserRole[] = ["operations_manager", "hr_payroll", "supervisor", "controller"];

/** Map free-text to a staff UserRole. Returns null if unrecognized. */
function parseStaffRoleInput(raw: string): UserRole | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;

  const asKey = t.replace(/\s+/g, "_").replace(/&/g, "and").replace(/[^a-z0-9_]/g, "");
  const squish = t.replace(/[\s&.,-]+/g, "");

  for (const r of STAFF_ROLES) {
    if (r === t || r === asKey) return r;
    const label = ROLE_LABELS[r].toLowerCase();
    const labelKey = label.replace(/\s+/g, "_").replace(/&/g, "and").replace(/[^a-z0-9_]/g, "");
    if (label === t || labelKey === asKey) return r;
  }

  const aliases: Record<string, UserRole> = {
    om: "operations_manager",
    operationsmanager: "operations_manager",
    opsmanager: "operations_manager",
    hr: "hr_payroll",
    hrandpayroll: "hr_payroll",
    hrpayroll: "hr_payroll",
    payroll: "hr_payroll",
    pay: "hr_payroll",
    sup: "supervisor",
    ctrl: "controller",
  };
  if (aliases[squish]) return aliases[squish];
  if (aliases[asKey.replace(/_/g, "")]) return aliases[asKey.replace(/_/g, "")];

  return null;
}

export default function SettingsPage() {
  const { user, token, logout } = useAuth();
  const { settings, loading, update, refresh, error } = useSettings();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const isFullAdminUser = user ? isFullAdmin(user) : false;
  const tabIds: Tab[] = ["profile", "business", "settings", "users", "migrate", "factory_reset"];
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && tabIds.includes(tabParam) ? tabParam : "profile");

  useEffect(() => {
    if (tabParam && tabIds.includes(tabParam)) {
      setActiveTab(tabParam as Tab);
    }
  }, [tabParam]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; adminOnly?: boolean; href?: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "business", label: "Business Details" },
    { id: "settings", label: "Business Settings" },
    { id: "users", label: "Users", adminOnly: true },
    { id: "migrate", label: "Bulk Import/Export", href: "/settings/migrate" },
    { id: "factory_reset", label: "Factory Reset", adminOnly: true },
  ];

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-10 h-10 rounded-sm bg-neutral-100 dark:bg-neutral-900/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 className="page-title mb-6">Settings</h1>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {error}
        </div>
      )}

      {!isFullAdminUser && activeTab !== "profile" && (
        <div className="mb-4 p-3 text-sm text-neutral-700 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/20 rounded-sm border border-neutral-200 dark:border-neutral-600">
          Only full administrators can edit business details and settings.
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-neutral-200 dark:border-neutral-700 overflow-x-auto">
        {tabs
          .filter((t) => !t.adminOnly || isFullAdminUser)
          .map((tab) => {
            const tabProps = {
              key: tab.id,
              className: clsx(
                "px-4 py-2.5 text-sm font-medium rounded-t-sm transition-colors",
                activeTab === tab.id
                  ? "bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 border-b-transparent -mb-px"
                  : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
              ),
            };
            return tab.href ? (
              <Link href={tab.href} {...tabProps}>
                {tab.label}
              </Link>
            ) : (
              <button
                {...tabProps}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
      </div>

      <div className={clsx("card-wireframe p-6", activeTab === "profile" && "max-w-[50%]")}>
        {activeTab === "profile" && (
          <ProfileSection user={user} />
        )}
        {activeTab === "business" && (
          <BusinessDetailsSection
            readOnly={!isFullAdminUser}
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
            readOnly={!isFullAdminUser}
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
        {activeTab === "users" && isFullAdminUser && token && (
          <UsersSection token={token} currentUserId={user?.id} />
        )}
        {activeTab === "factory_reset" && isFullAdminUser && token && (
          <FactoryResetSection token={token} refresh={refresh} logout={logout} />
        )}
      </div>
    </div>
  );
}

function ProfileSection({ user }: { user: { name?: string; email?: string; role?: string } | null }) {
  return (
    <div className="text-left">
      <h3 className="font-semibold text-neutral-800 dark:text-white mb-4">Profile</h3>
      <dl className="space-y-3 text-sm text-left">
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
          <dd className="text-neutral-900 dark:text-white capitalize">{user?.role}</dd>
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
    fax: "",
    psiraRegistration: "",
    uifReference: "",
    payeReference: "",
    sdlReference: "",
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
        fax: settings.fax ?? "",
        psiraRegistration: settings.psiraRegistration ?? "",
        uifReference: settings.uifReference ?? "",
        payeReference: settings.payeReference ?? "",
        sdlReference: settings.sdlReference ?? "",
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
        <div className="border-t border-neutral-200 dark:border-neutral-700 pt-6 mt-6">
          <h4 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-4">Payslip & Compliance</h4>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-4">
            These details appear on payslips and reports. Used for PSIRA, UIF, PAYE, SDL, and tax compliance.
          </p>
          {settings?.sdlLiableFrom && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
              SDL liable from {new Date(settings.sdlLiableFrom).toLocaleDateString()}. Add SDL reference when registering with SARS.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">PSIRA Registration</label>
              <input
                type="text"
                value={form.psiraRegistration}
                onChange={(e) => setForm((f) => ({ ...f, psiraRegistration: e.target.value }))}
                className="input-modern"
                placeholder="Company PSIRA number"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Company Registration</label>
              <input
                type="text"
                value={form.registrationNumber}
                onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))}
                className="input-modern"
                placeholder="Registration number"
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
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">UIF Reference</label>
              <input
                type="text"
                value={form.uifReference}
                onChange={(e) => setForm((f) => ({ ...f, uifReference: e.target.value }))}
                className="input-modern"
                placeholder="UIF reference (starts with U)"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">PAYE Reference</label>
              <input
                type="text"
                value={form.payeReference}
                onChange={(e) => setForm((f) => ({ ...f, payeReference: e.target.value }))}
                className="input-modern"
                placeholder="PAYE reference (starts with 7)"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">SDL Reference</label>
              <input
                type="text"
                value={form.sdlReference}
                onChange={(e) => setForm((f) => ({ ...f, sdlReference: e.target.value }))}
                className="input-modern"
                placeholder="SDL reference (starts with L)"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Telephone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="input-modern"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Fax</label>
              <input
                type="text"
                value={form.fax}
                onChange={(e) => setForm((f) => ({ ...f, fax: e.target.value }))}
                className="input-modern"
                placeholder="Fax number"
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
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Team Member ID Prefix</label>
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
            Prefix for auto-generated team member IDs (e.g. EMP-0001, STAFF-0001)
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
    role: "supervisor" as UserRole,
  });
  const [latestSetupLink, setLatestSetupLink] = useState<string | null>(null);
  const [setupLinkCopied, setSetupLinkCopied] = useState(false);
  const [addAccountKind, setAddAccountKind] = useState<"admin" | "assign">("assign");
  const [addStaffRoleInput, setAddStaffRoleInput] = useState(ROLE_LABELS.supervisor);
  const [addStaffRoleFieldError, setAddStaffRoleFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "supervisor" as UserRole,
  });
  /** Admin user: full tenant admin vs scoped (explicit module list). */
  const [addAdminFullAccess, setAddAdminFullAccess] = useState(true);
  /** Non-admin: assign modules vs no app access (pending page). */
  const [addGrantAppModules, setAddGrantAppModules] = useState(true);
  const [addCustomModules, setAddCustomModules] = useState<string[]>(() => defaultModulesForRole("supervisor"));
  const [editAdminFullAccess, setEditAdminFullAccess] = useState(true);
  const [editGrantAppModules, setEditGrantAppModules] = useState(true);
  const [editCustomModules, setEditCustomModules] = useState<string[]>([]);
  const [editAccountKind, setEditAccountKind] = useState<"admin" | "assign">("assign");
  const [editStaffRoleInput, setEditStaffRoleInput] = useState(ROLE_LABELS.supervisor);
  const [editStaffRoleFieldError, setEditStaffRoleFieldError] = useState<string | null>(null);

  const assignableModules = (role: UserRole) =>
    MODULE_ASSIGN_OPTIONS.filter((m) => m.href !== "/audit" || role === "admin");

  const toggleCustomModule = (href: string, setList: React.Dispatch<React.SetStateAction<string[]>>) => {
    setList((prev) => (prev.includes(href) ? prev.filter((x) => x !== href) : [...prev, href]));
  };

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

  useEffect(() => {
    if (addForm.role === "admin") {
      setAddAdminFullAccess(true);
      return;
    }
    setAddGrantAppModules(true);
    setAddCustomModules(defaultModulesForRole(addForm.role));
  }, [addForm.role]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    let resolvedRole: UserRole = addForm.role;
    let modulesForPayload = addCustomModules;
    let roleLabelForPayload: string | null = null;

    if (addAccountKind === "assign") {
      const typedRole = addStaffRoleInput.trim();
      if (!typedRole) {
        setError("Please enter a role title.");
        setAddStaffRoleFieldError("Role is required.");
        return;
      }
      roleLabelForPayload = typedRole;
      const parsedRole = parseStaffRoleInput(typedRole);
      resolvedRole = parsedRole ?? "supervisor";
      if (resolvedRole !== addForm.role) {
        modulesForPayload = defaultModulesForRole(resolvedRole);
      }
    } else {
      resolvedRole = "admin";
      roleLabelForPayload = null;
    }

    if (resolvedRole === "admin") {
      if (!addAdminFullAccess && modulesForPayload.length === 0) {
        setError("Select at least one module for a scoped administrator, or choose Full access.");
        return;
      }
    } else if (addGrantAppModules && modulesForPayload.length === 0) {
      setError("Select at least one module, or choose No app access.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      let payload: Parameters<typeof createUser>[1];
      if (resolvedRole === "admin") {
        payload = addAdminFullAccess
          ? { ...addForm, role: "admin", roleLabel: null, sendSetupLink: true }
          : { ...addForm, role: "admin", roleLabel: null, sendSetupLink: true, moduleAccess: modulesForPayload };
      } else if (addGrantAppModules) {
        payload = {
          ...addForm,
          role: resolvedRole,
          roleLabel: roleLabelForPayload,
          sendSetupLink: true,
          moduleAccess: modulesForPayload,
        };
      } else {
        payload = { ...addForm, role: resolvedRole, roleLabel: roleLabelForPayload, sendSetupLink: true, moduleAccess: null };
      }
      const created = await createUser(token, payload);
      setLatestSetupLink(created.setupLink ?? null);
      setSetupLinkCopied(false);
      setAddForm({ name: "", email: "", role: "supervisor" });
      setAddStaffRoleInput(ROLE_LABELS.supervisor);
      setAddStaffRoleFieldError(null);
      setAddAccountKind("assign");
      setAddAdminFullAccess(true);
      setAddGrantAppModules(true);
      setAddCustomModules(defaultModulesForRole("supervisor"));
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

    let resolvedEditRole: UserRole = editForm.role;
    let editModulesPayload = editCustomModules;
    let editRoleLabelForPayload: string | null = null;

    if (editAccountKind === "assign") {
      const typedRole = editStaffRoleInput.trim();
      if (!typedRole) {
        setError("Please enter a role title.");
        setEditStaffRoleFieldError("Role is required.");
        return;
      }
      editRoleLabelForPayload = typedRole;
      const parsedRole = parseStaffRoleInput(typedRole);
      resolvedEditRole = parsedRole ?? "supervisor";
      if (resolvedEditRole !== editForm.role) {
        editModulesPayload = defaultModulesForRole(resolvedEditRole);
      }
    } else {
      resolvedEditRole = "admin";
      editRoleLabelForPayload = null;
    }

    if (resolvedEditRole === "admin") {
      if (!editAdminFullAccess && editModulesPayload.length === 0) {
        setError("Select at least one module for a scoped administrator, or choose Full access.");
        return;
      }
    } else if (editGrantAppModules && editModulesPayload.length === 0) {
      setError("Select at least one module, or choose No app access.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload: Partial<{
        name: string;
        email: string;
        password: string;
        role: UserRole;
        roleLabel: string | null;
        moduleAccess: string[] | null;
      }> = {
        name: editForm.name,
        email: editForm.email,
        role: resolvedEditRole,
        roleLabel: editRoleLabelForPayload,
        moduleAccess:
          resolvedEditRole === "admin"
            ? editAdminFullAccess
              ? null
              : editModulesPayload
            : editGrantAppModules
              ? editModulesPayload
              : null,
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
    setEditAccountKind(u.role === "admin" ? "admin" : "assign");
    setEditStaffRoleFieldError(null);
    setEditStaffRoleInput(u.role === "admin" ? ROLE_LABELS.supervisor : (u.roleLabel?.trim() || ROLE_LABELS[u.role]));
    setEditForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
    });
    const norm = normalizeUserModuleAccess(u.moduleAccess);
    if (u.role === "admin") {
      setEditAdminFullAccess(!norm);
      setEditCustomModules(norm ?? defaultModulesForRole("admin"));
    } else {
      setEditGrantAppModules(!!norm);
      setEditCustomModules(norm ?? defaultModulesForRole(u.role));
    }
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
      <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 leading-relaxed max-w-3xl space-y-3">
        <p>
          Use this page to invite people and control <strong className="font-medium text-neutral-800 dark:text-neutral-200">what they can open in Plethora</strong>—not everyone needs to see payroll, team, or settings.
        </p>
        <ul className="list-disc pl-5 space-y-1.5 marker:text-neutral-400">
          <li>
            <strong className="font-medium text-neutral-800 dark:text-neutral-200">Full admin</strong> — can use the whole app (including users and audit). Pick “Admin” and full access when adding them.
          </li>
          <li>
            <strong className="font-medium text-neutral-800 dark:text-neutral-200">Everyone else</strong> — tick only the sections they need. If something isn’t ticked, they won’t see it in the menu.
          </li>
          <li>
            <strong className="font-medium text-neutral-800 dark:text-neutral-200">No app access</strong> — the account stays active, but they’ll see a “waiting for access” note until you turn on at least one section.
          </li>
          <li>
            After you save changes, ask that person to <strong className="font-medium text-neutral-800 dark:text-neutral-200">sign out and back in</strong> so their screen updates.
          </li>
        </ul>
        <p className="text-xs text-neutral-500 dark:text-neutral-500 pt-1">
          Trouble saving? The database may need an update for permissions—your IT person can run{" "}
          <code className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono text-[11px]">npm run db:add-module-access</code> or{" "}
          <code className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded font-mono text-[11px]">npm run db:push</code> from the project folder.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {error}
        </div>
      )}
      {latestSetupLink && (
        <div className="mb-4 p-3 text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded-sm border border-emerald-200 dark:border-emerald-800/50 space-y-2">
          <p className="font-medium">User created. Share this password setup link:</p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <code className="px-2 py-1 rounded bg-white/80 dark:bg-neutral-900/50 border border-emerald-200/70 dark:border-emerald-800/60 break-all text-[11px]">
              {latestSetupLink}
            </code>
            <button
              type="button"
              className="btn-secondary whitespace-nowrap"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(latestSetupLink);
                  setSetupLinkCopied(true);
                } catch {
                  setSetupLinkCopied(false);
                }
              }}
            >
              {setupLinkCopied ? "Copied" : "Copy Link"}
            </button>
          </div>
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
            className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 space-y-4"
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
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">Account</label>
                <select
                  value={addAccountKind}
                  onChange={(e) => {
                    const k = e.target.value as "admin" | "assign";
                    setAddAccountKind(k);
                    if (k === "admin") {
                      setAddForm((f) => ({ ...f, role: "admin" }));
                    } else {
                      setAddForm((f) => ({ ...f, role: "supervisor" }));
                      setAddStaffRoleInput(ROLE_LABELS.supervisor);
                      setAddStaffRoleFieldError(null);
                    }
                  }}
                  className="input-modern"
                >
                  <option value="admin">Admin</option>
                  <option value="assign">Assign Role</option>
                </select>
                {addAccountKind === "assign" && (
                  <>
                    <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mt-3 mb-1">
                      Role
                    </label>
                    <input
                      type="text"
                      value={addStaffRoleInput}
                      onChange={(e) => {
                        setAddStaffRoleInput(e.target.value);
                        setAddStaffRoleFieldError(null);
                      }}
                      onBlur={() => {
                        if (!addStaffRoleInput.trim()) {
                          setAddStaffRoleFieldError("Role is required.");
                        }
                      }}
                      className="input-modern"
                      placeholder="e.g. Site Supervisor, HR & Payroll, operations_manager"
                      autoComplete="off"
                    />
                    {addStaffRoleFieldError && (
                      <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{addStaffRoleFieldError}</p>
                    )}
                  </>
                )}
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5">
                  Choose Admin or Assign Role, then type any role title manually. Module rules apply below.
                </p>
              </div>
            </div>
            <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-neutral-800 dark:text-white">Module access</p>
              {addForm.role === "admin" ? (
                <>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                      <input
                        type="radio"
                        name="addAdminAccess"
                        checked={addAdminFullAccess}
                        onChange={() => setAddAdminFullAccess(true)}
                        className="border-neutral-300"
                      />
                      Full access (all modules, user management, audit)
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                      <input
                        type="radio"
                        name="addAdminAccess"
                        checked={!addAdminFullAccess}
                        onChange={() => {
                          setAddAdminFullAccess(false);
                          setAddCustomModules(defaultModulesForRole("admin"));
                        }}
                        className="border-neutral-300"
                      />
                      Scoped admin (select modules below)
                    </label>
                  </div>
                  {!addAdminFullAccess && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {assignableModules("admin").map((m) => (
                        <label key={m.href} className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                          <input
                            type="checkbox"
                            checked={addCustomModules.includes(m.href)}
                            onChange={() => toggleCustomModule(m.href, setAddCustomModules)}
                            className="border-neutral-300 rounded"
                          />
                          {m.label}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                      <input
                        type="radio"
                        name="addGrantModules"
                        checked={addGrantAppModules}
                        onChange={() => setAddGrantAppModules(true)}
                        className="border-neutral-300"
                      />
                      Assign modules (tick at least one)
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                      <input
                        type="radio"
                        name="addGrantModules"
                        checked={!addGrantAppModules}
                        onChange={() => setAddGrantAppModules(false)}
                        className="border-neutral-300"
                      />
                      No app access (login only until you assign modules later)
                    </label>
                  </div>
                  {addGrantAppModules && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {assignableModules(addForm.role).map((m) => (
                        <label key={m.href} className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                          <input
                            type="checkbox"
                            checked={addCustomModules.includes(m.href)}
                            onChange={() => toggleCustomModule(m.href, setAddCustomModules)}
                            className="border-neutral-300 rounded"
                          />
                          {m.label}
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <button type="submit" disabled={submitting} className="btn-primary">
              {submitting ? "Adding..." : "Add User"}
            </button>
          </form>
        )}

        <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 dark:bg-neutral-800/50 border-b border-neutral-200 dark:border-neutral-700">
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Name</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Email</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Role</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300">Modules</th>
                <th className="text-right py-3 px-4 font-medium text-neutral-700 dark:text-neutral-300 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <React.Fragment key={u.id}>
                  <tr
                    key={u.id}
                    className="border-b border-neutral-200 dark:border-neutral-700 last:border-0 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30"
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
                      {editingUserId === u.id ? null : (u.roleLabel?.trim() || ROLE_LABELS[u.role])}
                    </td>
                    <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400 text-xs">
                      {editingUserId === u.id
                        ? null
                        : (() => {
                            const m = normalizeUserModuleAccess(u.moduleAccess);
                            if (m) return `${m.length} assigned`;
                            if (u.role === "admin") return "Full admin";
                            return "None (pending)";
                          })()}
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
                    <tr className="border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
                      <td colSpan={5} className="py-4 px-4">
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
                              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                                Account
                              </label>
                              <select
                                value={editAccountKind}
                                onChange={(e) => {
                                  const k = e.target.value as "admin" | "assign";
                                  setEditAccountKind(k);
                                  if (k === "admin") {
                                    setEditForm((f) => ({ ...f, role: "admin" }));
                                    setEditAdminFullAccess(true);
                                    setEditCustomModules(defaultModulesForRole("admin"));
                                  } else {
                                    setEditForm((f) => ({ ...f, role: "supervisor" }));
                                    setEditStaffRoleInput(ROLE_LABELS.supervisor);
                                    setEditStaffRoleFieldError(null);
                                    setEditGrantAppModules(true);
                                    setEditCustomModules(defaultModulesForRole("supervisor"));
                                  }
                                }}
                                className="input-modern"
                              >
                                <option value="admin">Admin</option>
                                <option value="assign">Assign Role</option>
                              </select>
                              {editAccountKind === "assign" && (
                                <>
                                  <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mt-3 mb-1">
                                    Role
                                  </label>
                                  <input
                                    type="text"
                                    value={editStaffRoleInput}
                                    onChange={(e) => {
                                      setEditStaffRoleInput(e.target.value);
                                      setEditStaffRoleFieldError(null);
                                    }}
                                    onBlur={() => {
                                      if (!editStaffRoleInput.trim()) {
                                        setEditStaffRoleFieldError("Role is required.");
                                      }
                                    }}
                                    className="input-modern"
                                    placeholder="e.g. Site Supervisor, HR & Payroll, operations_manager"
                                    autoComplete="off"
                                  />
                                  {editStaffRoleFieldError && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                      {editStaffRoleFieldError}
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg p-4 space-y-3">
                            <p className="text-sm font-medium text-neutral-800 dark:text-white">Module access</p>
                            {editForm.role === "admin" ? (
                              <>
                                <div className="flex flex-wrap gap-4">
                                  <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                                    <input
                                      type="radio"
                                      name="editAdminAccess"
                                      checked={editAdminFullAccess}
                                      onChange={() => setEditAdminFullAccess(true)}
                                      className="border-neutral-300"
                                    />
                                    Full access
                                  </label>
                                  <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                                    <input
                                      type="radio"
                                      name="editAdminAccess"
                                      checked={!editAdminFullAccess}
                                      onChange={() => {
                                        setEditAdminFullAccess(false);
                                        setEditCustomModules(defaultModulesForRole("admin"));
                                      }}
                                      className="border-neutral-300"
                                    />
                                    Scoped (select modules)
                                  </label>
                                </div>
                                {!editAdminFullAccess && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                    {assignableModules("admin").map((m) => (
                                      <label
                                        key={m.href}
                                        className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={editCustomModules.includes(m.href)}
                                          onChange={() => toggleCustomModule(m.href, setEditCustomModules)}
                                          className="border-neutral-300 rounded"
                                        />
                                        {m.label}
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <div className="flex flex-wrap gap-4">
                                  <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                                    <input
                                      type="radio"
                                      name="editGrantModules"
                                      checked={editGrantAppModules}
                                      onChange={() => setEditGrantAppModules(true)}
                                      className="border-neutral-300"
                                    />
                                    Assign modules
                                  </label>
                                  <label className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300">
                                    <input
                                      type="radio"
                                      name="editGrantModules"
                                      checked={!editGrantAppModules}
                                      onChange={() => setEditGrantAppModules(false)}
                                      className="border-neutral-300"
                                    />
                                    No app access
                                  </label>
                                </div>
                                {editGrantAppModules && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                    {assignableModules(editForm.role).map((m) => (
                                      <label
                                        key={m.href}
                                        className="flex items-center gap-2 text-sm cursor-pointer text-neutral-700 dark:text-neutral-300"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={editCustomModules.includes(m.href)}
                                          onChange={() => toggleCustomModule(m.href, setEditCustomModules)}
                                          className="border-neutral-300 rounded"
                                        />
                                        {m.label}
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
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

const CONFIRM_PHRASE = "FACTORY RESET";

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
}

function FactoryResetSection({
  token,
  refresh,
  logout,
}: {
  token: string;
  refresh: () => Promise<void>;
  logout: () => void;
}) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resetAll, setResetAll] = useState(false);
  const [selectedModules, setSelectedModules] = useState<Set<FactoryResetModuleId>>(new Set());
  const [attendanceEmployeeId, setAttendanceEmployeeId] = useState<string>("");
  const [attendanceFromDate, setAttendanceFromDate] = useState<string>("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const toggleModule = (id: FactoryResetModuleId) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedModules(new Set(FACTORY_RESET_MODULES.map((m) => m.id)));
  };

  const deselectAll = () => {
    setSelectedModules(new Set());
    setAttendanceEmployeeId("");
    setAttendanceFromDate("");
  };

  useEffect(() => {
    if (selectedModules.has("attendance") && token) {
      authFetch("/employees?limit=500", token)
        .then((r) => r.json())
        .then((d) => setEmployees(d.data || []))
        .catch(() => setEmployees([]));
    } else {
      setEmployees([]);
      setAttendanceEmployeeId("");
    }
  }, [selectedModules, token]);

  const modulesToReset: FactoryResetModuleId[] | undefined =
    resetAll ? undefined : Array.from(selectedModules);
  const hasSelection = resetAll || selectedModules.size > 0;
  const canReset =
    confirmText === CONFIRM_PHRASE && !resetting && hasSelection;

  const handleReset = async () => {
    if (!canReset) return;
    setResetting(true);
    setError(null);
    try {
      const isFullReset = resetAll;
      const options = selectedModules.has("attendance")
        ? {
            ...(attendanceEmployeeId && { attendanceEmployeeId }),
            ...(attendanceFromDate && { attendanceFromDate }),
          }
        : undefined;
      await factoryReset(token, modulesToReset, options);
      if (isFullReset) {
        logout();
        router.push("/register?next=/settings");
        return;
      }

      await refresh();
      setSuccess(true);
      setConfirmText("");
      setResetAll(false);
      setSelectedModules(new Set());
      setAttendanceEmployeeId("");
      setAttendanceFromDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Factory reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <h3 className="font-semibold text-neutral-800 dark:text-white mb-4">Factory Reset</h3>
      <div className="max-w-2xl space-y-4">
        <div className="p-4 rounded-sm border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-2">
            This action cannot be undone.
          </p>
          <p className="text-sm text-red-700 dark:text-red-300">
            Select which modules to reset. Module resets clear or restore data only for the selected
            modules. If you choose &quot;Reset all modules&quot;, the system permanently deletes this
            company, all users, and all company data.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="reset-all"
              checked={resetAll}
              onChange={(e) => setResetAll(e.target.checked)}
              disabled={resetting}
              className="rounded border-neutral-300 dark:border-neutral-600"
            />
            <label
              htmlFor="reset-all"
              className="text-sm font-medium text-neutral-800 dark:text-neutral-200 cursor-pointer"
            >
              Reset all modules (full factory reset)
            </label>
          </div>

          {!resetAll && (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 underline"
                >
                  Deselect all
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {FACTORY_RESET_MODULES.map((mod) => (
                  <div
                    key={mod.id}
                    className={clsx(
                      "flex items-start gap-2 p-2 rounded-sm border border-neutral-200 dark:border-neutral-700",
                      mod.id === "attendance" && "sm:col-span-2"
                    )}
                  >
                    <input
                      type="checkbox"
                      id={`mod-${mod.id}`}
                      checked={selectedModules.has(mod.id)}
                      onChange={() => toggleModule(mod.id)}
                      disabled={resetting}
                      className="mt-0.5 rounded border-neutral-300 dark:border-neutral-600"
                    />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`mod-${mod.id}`}
                        className="text-sm cursor-pointer block"
                      >
                        <span className="font-medium text-neutral-800 dark:text-neutral-200">
                          {mod.label}
                        </span>
                        <span className="block text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {mod.description}
                        </span>
                      </label>
                      {mod.id === "attendance" && selectedModules.has("attendance") && (
                        <div className="mt-2 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                              Reset from date (optional)
                            </label>
                            <DateInput
                              value={attendanceFromDate}
                              onChange={setAttendanceFromDate}
                              className="input-modern py-1.5 text-sm w-full max-w-xs"
                              showToday
                              disabled={resetting}
                            />
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                              Leave empty to reset all attendance. Set a date to reset only from that date onwards.
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                              Reset for person (optional)
                            </label>
                            <select
                              value={attendanceEmployeeId}
                              onChange={(e) => setAttendanceEmployeeId(e.target.value)}
                              disabled={resetting}
                              className="input-modern py-1.5 text-sm w-full max-w-xs"
                            >
                              <option value="">All people</option>
                              {employees.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.firstName} {e.lastName}
                                </option>
                              ))}
                            </select>
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                              Leave as &quot;All people&quot; to reset everyone&apos;s attendance.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
            Type <strong>{CONFIRM_PHRASE}</strong> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            className="input-modern font-mono"
            placeholder={CONFIRM_PHRASE}
            disabled={resetting}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {success && (
          <p className="text-sm text-security-navy-600 dark:text-security-navy-400">
            Factory reset completed successfully.
          </p>
        )}

        <button
          type="button"
          onClick={handleReset}
          disabled={!canReset}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-neutral-400 disabled:cursor-not-allowed rounded-sm transition-colors"
        >
          {resetting ? "Resetting..." : "Factory Reset"}
        </button>
      </div>
    </div>
  );
}
