"use client";

import type { RosterPeriodCalendarConfig } from "@/lib/api";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getCapabilityCatalog,
  transferCompanyOwnership,
  factoryReset,
  FACTORY_RESET_MODULES,
  authFetch,
  type AccountType,
  type Capability,
  type CapabilityDefinition,
  type CapabilityMap,
  type UserListItem,
  type FactoryResetModuleId,
  type AuthUser,
} from "@/lib/api";
import { canAccessMigrationTools, hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import { useConfirmDialog } from "@/components/ui";
import { ClientsSettingsSection } from "@/components/clients-settings-section";
import { CapabilityUsersSection } from "@/components/capability-users-section";
import { clsx } from "clsx";

type Tab = "profile" | "business" | "settings" | "users" | "clients" | "migrate" | "factory_reset";

export default function SettingsPage() {
  const { user, token, logout } = useAuth();
  const { settings, loading, update, refresh, error } = useSettings();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;
  const canEditSettings = Boolean(user && hasCapability(user, "/settings", "edit"));
  const canUseMigrationTools = Boolean(user && canAccessMigrationTools(user));
  const canViewAccess = Boolean(user && hasCapability(user, "/settings/access", "view"));
  const canManageClients = Boolean(user && hasCapability(user, "/clients", "view"));
  const isOwner = Boolean(user?.isOwner);
  const tabIds: Tab[] = ["profile", "business", "settings", "users", "clients", "migrate", "factory_reset"];
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && tabIds.includes(tabParam) ? tabParam : "profile");

  useEffect(() => {
    if (tabParam && tabIds.includes(tabParam)) {
      setActiveTab(tabParam as Tab);
    }
  }, [tabParam]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; visible?: boolean; href?: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "business", label: "Business Details" },
    { id: "settings", label: "Business Settings" },
    { id: "users", label: "User Access", visible: canViewAccess },
    { id: "clients", label: "Clients", visible: canManageClients },
    { id: "migrate", label: "Bulk Import/Export", visible: canUseMigrationTools, href: "/settings/migrate" },
    { id: "factory_reset", label: "Factory Reset", visible: isOwner },
  ];

  if (loading && !settings) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="w-10 h-10 rounded-sm bg-security-navy-50 dark:bg-security-navy-900/30 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="page-title">Settings</h1>
        <p className="mt-1 text-sm text-security-navy-600">
          Manage your profile, company details, users, and system options.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-sm border border-red-200 dark:border-red-800/50">
          {error}
        </div>
      )}

      {!canEditSettings && activeTab !== "profile" && activeTab !== "users" && (
        <div className="mb-4 p-3 text-sm text-security-navy-700 dark:text-security-navy-400 bg-security-navy-50 dark:bg-security-navy-900/20 rounded-sm border border-security-navy-100 dark:border-security-navy-600">
          Your current access is read-only for company settings.
        </div>
      )}

      <div className="flex gap-1 mb-6 border-b border-security-navy-100 dark:border-security-navy-700 overflow-x-auto">
        {tabs
          .filter((t) => t.visible !== false)
          .map((tab) => {
            const tabProps = {
              className: clsx(
                "px-4 py-2.5 text-sm font-medium rounded-t-sm transition-colors",
                activeTab === tab.id
                  ? "bg-white dark:bg-security-navy-800 text-security-navy-900 dark:text-security-navy-200 border border-security-navy-100 dark:border-security-navy-700 border-b-transparent -mb-px"
                  : "text-security-navy-600 dark:text-security-navy-400 hover:text-security-navy-900 dark:hover:text-white"
              ),
            };
            return tab.href ? (
              <Link key={tab.id} href={tab.href} {...tabProps}>
                {tab.label}
              </Link>
            ) : (
              <button
                key={tab.id}
                {...tabProps}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
      </div>

      <div className={clsx("card-wireframe p-6 w-full max-w-6xl mx-auto", activeTab === "profile" && "sm:max-w-xl")}>
        {activeTab === "profile" && (
          <ProfileSection user={user} />
        )}
        {activeTab === "business" && (
          <BusinessDetailsSection
            readOnly={!canEditSettings}
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
            readOnly={!canEditSettings}
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
        {activeTab === "users" && canViewAccess && token && (
          <CapabilityUsersSection token={token} currentUser={user!} />
        )}
        {activeTab === "clients" && canManageClients && token && (
          <ClientsSettingsSection token={token} />
        )}
        {activeTab === "factory_reset" && isOwner && token && (
          <FactoryResetSection token={token} refresh={refresh} logout={logout} />
        )}
      </div>
    </div>
  );
}

function ProfileSection({ user }: { user: AuthUser | null }) {
  return (
    <div className="text-left">
      <h3 className="font-semibold text-security-navy-900 dark:text-white mb-4">Profile</h3>
      <dl className="space-y-3 text-sm text-left">
        <div>
          <dt className="text-security-navy-500 dark:text-security-navy-400">Name</dt>
          <dd className="text-security-navy-900 dark:text-white">{user?.name}</dd>
        </div>
        <div>
          <dt className="text-security-navy-500 dark:text-security-navy-400">Email</dt>
          <dd className="text-security-navy-900 dark:text-white">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-security-navy-500 dark:text-security-navy-400">Account</dt>
          <dd className="text-security-navy-900 dark:text-white">
            {user?.isOwner ? "Company owner" : user?.jobTitle || (user?.accountType === "client" ? "Client" : "Staff")}
          </dd>
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
      <h3 className="font-semibold text-security-navy-900 dark:text-white mb-4">Business Details</h3>
      <p className="text-sm text-security-navy-500 dark:text-security-navy-400 mb-6">
        Configure your company information. This is used across the system (invoices, reports, etc.).
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Company Name</label>
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
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Legal Name</label>
          <input
            type="text"
            value={form.legalName}
            onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
            className="input-modern"
            placeholder="Quick Bopha Security (Pty) Ltd"
            readOnly={readOnly}
          />
        </div>
        <div className="border-t border-security-navy-100 dark:border-security-navy-700 pt-6 mt-6">
          <h4 className="text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-4">Payslip & Compliance</h4>
          <p className="text-xs text-security-navy-500 dark:text-security-navy-400 mb-4">
            These details appear on payslips and reports. Used for PSIRA, UIF, PAYE, SDL, and tax compliance.
          </p>
          {settings?.sdlLiableFrom && (
            <p className="text-xs text-security-amber-600 dark:text-security-amber-400 mb-4">
              SDL liable from {new Date(settings.sdlLiableFrom).toLocaleDateString()}. Add SDL reference when registering with SARS.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">PSIRA Registration</label>
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
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Company Registration</label>
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
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Tax Number</label>
              <input
                type="text"
                value={form.taxNumber}
                onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))}
                className="input-modern"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">UIF Reference</label>
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
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">PAYE Reference</label>
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
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">SDL Reference</label>
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
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Telephone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="input-modern"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Fax</label>
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
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Email</label>
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
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Address</label>
          <textarea
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className="input-modern min-h-[80px]"
            rows={3}
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Website</label>
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
  onSave: (data: Record<string, string | number | null | RosterPeriodCalendarConfig[]>) => Promise<void>;
  readOnly?: boolean;
}) {
  const bizSettings = settings?.settings ?? {};
  const [form, setForm] = useState({
    currency: "ZAR",
    dateFormat: "DD/MM/YYYY",
    timezone: "Africa/Johannesburg",
    payrollPeriod: "monthly",
    employeeIdPrefix: "EMP",
    payPeriodStartDay: "26",
    payPeriodEndDay: "25",
    autoRosterHorizonPeriods: "2",
    rosterPeriodCalendars: [] as RosterPeriodCalendarConfig[],
    defaultRosterPeriodCalendarId: "pay-aligned",
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
        payPeriodStartDay: String(s.payPeriodStartDay ?? 26),
        payPeriodEndDay: String(s.payPeriodEndDay ?? 25),
        autoRosterHorizonPeriods: String(s.autoRosterHorizonPeriods ?? 2),
        rosterPeriodCalendars:
          s.rosterPeriodCalendars && s.rosterPeriodCalendars.length > 0
            ? s.rosterPeriodCalendars
            : [
                {
                  id: "pay-aligned",
                  name: "Pay period aligned",
                  startDay: s.payPeriodStartDay ?? 26,
                  endDay: s.payPeriodEndDay ?? 25,
                },
              ],
        defaultRosterPeriodCalendarId: s.defaultRosterPeriodCalendarId ?? "pay-aligned",
      });
    }
  }, [settings?.settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const horizon = parseInt(form.autoRosterHorizonPeriods, 10);
    const startDay = parseInt(form.payPeriodStartDay, 10);
    const endDay = parseInt(form.payPeriodEndDay, 10);
    const calendars =
      form.rosterPeriodCalendars.length > 0
        ? form.rosterPeriodCalendars
        : [{ id: "pay-aligned", name: "Pay period aligned", startDay: startDay || 26, endDay: endDay || 25 }];
    const defaultCalendarId = calendars.some((c) => c.id === form.defaultRosterPeriodCalendarId)
      ? form.defaultRosterPeriodCalendarId
      : calendars[0]!.id;
    onSave({
      currency: form.currency,
      dateFormat: form.dateFormat,
      timezone: form.timezone,
      payrollPeriod: form.payrollPeriod,
      employeeIdPrefix: form.employeeIdPrefix,
      payPeriodStartDay: Number.isFinite(startDay) ? startDay : 26,
      payPeriodEndDay: Number.isFinite(endDay) ? endDay : 25,
      autoRosterHorizonPeriods: Number.isFinite(horizon) && horizon >= 1 ? horizon : 2,
      rosterPeriodCalendars: calendars.map((calendar) => ({
        ...calendar,
        startDay: Math.min(31, Math.max(1, calendar.startDay)),
        endDay: Math.min(31, Math.max(1, calendar.endDay)),
      })),
      defaultRosterPeriodCalendarId: defaultCalendarId,
    });
  };

  return (
    <div>
      <h3 className="font-semibold text-security-navy-900 dark:text-white mb-4">Business Settings</h3>
      <p className="text-sm text-security-navy-500 dark:text-security-navy-400 mb-6">
        Configure defaults used for payroll, dates, and reporting.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Currency</label>
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
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Date Format</label>
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
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Timezone</label>
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
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">PAYE calculation frequency</label>
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
          <p className="text-xs text-security-navy-500 dark:text-security-navy-400 mt-1">
            Used for PAYE tax calculations only. Pay and roster period dates are configured below.
          </p>
        </div>
        <div className="rounded-security-lg border border-security-amber-200/80 dark:border-security-amber-800/40 bg-security-amber-50/40 dark:bg-security-amber-950/20 p-4 space-y-3">
          <p className="text-sm font-medium text-security-navy-900 dark:text-security-navy-100">Pay & roster period calendar</p>
          <p className="text-xs text-security-navy-500 dark:text-security-navy-400">
            Example: start 26, end 25 → 26 Jun–25 Jul is labelled <strong>July</strong> pay/roster period.
            Auto-roster maintains shifts through N pay periods ahead.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">
                Period start day (1–31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.payPeriodStartDay}
                onChange={(e) => setForm((f) => ({ ...f, payPeriodStartDay: e.target.value }))}
                className="input-modern w-full"
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">
                Period end day (1–31)
              </label>
              <input
                type="number"
                min={1}
                max={31}
                value={form.payPeriodEndDay}
                onChange={(e) => setForm((f) => ({ ...f, payPeriodEndDay: e.target.value }))}
                className="input-modern w-full"
                disabled={readOnly}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">
              Roster horizon (pay periods)
            </label>
            <input
              type="number"
              min={1}
              max={6}
              value={form.autoRosterHorizonPeriods}
              onChange={(e) => setForm((f) => ({ ...f, autoRosterHorizonPeriods: e.target.value }))}
              className="input-modern max-w-[8rem]"
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="rounded-security-lg border border-security-navy-100 dark:border-security-navy-700 bg-security-navy-50/60 dark:bg-security-navy-900/40 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-security-navy-900 dark:text-security-navy-100">Roster period calendars</p>
            <p className="text-xs text-security-navy-500 dark:text-security-navy-400 mt-1">
              Add different period date ranges for roster planning. Use start ≤ end for one calendar month
              (e.g. 1–31). Use start &gt; end for cross-month periods (e.g. 26–25). Payroll still uses the pay
              period dates above.
            </p>
          </div>
          <div className="space-y-3">
            {form.rosterPeriodCalendars.map((calendar, index) => (
              <div
                key={calendar.id}
                className="rounded-lg border border-security-navy-100 dark:border-security-navy-700 bg-white dark:bg-security-navy-900 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={calendar.name}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        rosterPeriodCalendars: f.rosterPeriodCalendars.map((row, i) =>
                          i === index ? { ...row, name: e.target.value } : row
                        ),
                      }))
                    }
                    className="input-modern flex-1 min-w-[10rem]"
                    placeholder="Calendar name"
                    disabled={readOnly}
                  />
                  <label className="inline-flex items-center gap-1.5 text-xs text-security-navy-600 dark:text-security-navy-300">
                    <input
                      type="radio"
                      name="defaultRosterCalendar"
                      checked={form.defaultRosterPeriodCalendarId === calendar.id}
                      onChange={() =>
                        setForm((f) => ({ ...f, defaultRosterPeriodCalendarId: calendar.id }))
                      }
                      disabled={readOnly}
                    />
                    Default for rostering
                  </label>
                  {!readOnly && form.rosterPeriodCalendars.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => {
                          const next = f.rosterPeriodCalendars.filter((_, i) => i !== index);
                          const defaultId =
                            f.defaultRosterPeriodCalendarId === calendar.id
                              ? next[0]!.id
                              : f.defaultRosterPeriodCalendarId;
                          return {
                            ...f,
                            rosterPeriodCalendars: next,
                            defaultRosterPeriodCalendarId: defaultId,
                          };
                        })
                      }
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-security-navy-600 dark:text-security-navy-400 mb-1">
                      Start day
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={calendar.startDay}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          rosterPeriodCalendars: f.rosterPeriodCalendars.map((row, i) =>
                            i === index
                              ? { ...row, startDay: parseInt(e.target.value, 10) || row.startDay }
                              : row
                          ),
                        }))
                      }
                      className="input-modern w-full"
                      disabled={readOnly}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-security-navy-600 dark:text-security-navy-400 mb-1">
                      End day
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={calendar.endDay}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          rosterPeriodCalendars: f.rosterPeriodCalendars.map((row, i) =>
                            i === index
                              ? { ...row, endDay: parseInt(e.target.value, 10) || row.endDay }
                              : row
                          ),
                        }))
                      }
                      className="input-modern w-full"
                      disabled={readOnly}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          {!readOnly && form.rosterPeriodCalendars.length < 8 && (
            <button
              type="button"
              onClick={() => {
                const id =
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `roster-${Date.now()}`;
                setForm((f) => ({
                  ...f,
                  rosterPeriodCalendars: [
                    ...f.rosterPeriodCalendars,
                    {
                      id,
                      name: `Calendar month ${f.rosterPeriodCalendars.length + 1}`,
                      startDay: 1,
                      endDay: 31,
                    },
                  ],
                }));
              }}
              className="btn-secondary text-sm"
            >
              Add roster period calendar
            </button>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">Team Member ID Prefix</label>
          <input
            type="text"
            value={form.employeeIdPrefix}
            onChange={(e) => setForm((f) => ({ ...f, employeeIdPrefix: e.target.value.toUpperCase() }))}
            className="input-modern"
            placeholder="EMP"
            maxLength={20}
            disabled={readOnly}
          />
          <p className="text-xs text-security-navy-500 dark:text-security-navy-400 mt-1">
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
  const [currentPassword, setCurrentPassword] = useState("");
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
    confirmText === CONFIRM_PHRASE &&
    currentPassword.length > 0 &&
    !resetting &&
    hasSelection;

  const handleReset = async () => {
    if (!canReset) return;
    setResetting(true);
    setError(null);
    try {
      const isFullReset = resetAll;
      const options = {
        currentPassword,
        confirmation: CONFIRM_PHRASE as typeof CONFIRM_PHRASE,
        ...(selectedModules.has("attendance") && attendanceEmployeeId
          ? { attendanceEmployeeId }
          : {}),
        ...(selectedModules.has("attendance") && attendanceFromDate
          ? { attendanceFromDate }
          : {}),
      };
      await factoryReset(token, modulesToReset, options);
      if (isFullReset) {
        logout();
        router.push("/register?next=/settings");
        return;
      }

      await refresh();
      setSuccess(true);
      setConfirmText("");
      setCurrentPassword("");
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
    <div className="text-center">
      <h3 className="font-semibold text-security-navy-900 dark:text-white mb-4">Factory Reset</h3>
      <div className="max-w-3xl mx-auto space-y-5">
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
          <div className="flex items-center justify-center gap-2">
            <input
              type="checkbox"
              id="reset-all"
              checked={resetAll}
              onChange={(e) => setResetAll(e.target.checked)}
              disabled={resetting}
              className="rounded border-security-navy-200 dark:border-security-navy-600"
            />
            <label
              htmlFor="reset-all"
              className="text-sm font-medium text-security-navy-900 dark:text-security-navy-200 cursor-pointer"
            >
              Reset all modules (full factory reset)
            </label>
          </div>

          {!resetAll && (
            <>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-security-navy-600 dark:text-security-navy-400 hover:text-security-navy-900 dark:hover:text-security-navy-200 underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-xs text-security-navy-600 dark:text-security-navy-400 hover:text-security-navy-900 dark:hover:text-security-navy-200 underline"
                >
                  Deselect all
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 text-left">
                {FACTORY_RESET_MODULES.map((mod) => (
                  <div
                    key={mod.id}
                    className={clsx(
                      "flex items-start gap-2 p-2 rounded-sm border border-security-navy-100 dark:border-security-navy-700",
                      mod.id === "attendance" && "sm:col-span-2"
                    )}
                  >
                    <input
                      type="checkbox"
                      id={`mod-${mod.id}`}
                      checked={selectedModules.has(mod.id)}
                      onChange={() => toggleModule(mod.id)}
                      disabled={resetting}
                      className="mt-0.5 rounded border-security-navy-200 dark:border-security-navy-600"
                    />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`mod-${mod.id}`}
                        className="text-sm cursor-pointer block"
                      >
                        <span className="font-medium text-security-navy-900 dark:text-security-navy-200">
                          {mod.label}
                        </span>
                        <span className="block text-xs text-security-navy-500 dark:text-security-navy-400 mt-0.5">
                          {mod.description}
                        </span>
                      </label>
                      {mod.id === "attendance" && selectedModules.has("attendance") && (
                        <div className="mt-2 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-security-navy-600 dark:text-security-navy-400 mb-1">
                              Reset from date (optional)
                            </label>
                            <DateInput
                              value={attendanceFromDate}
                              onChange={setAttendanceFromDate}
                              className="input-modern py-1.5 text-sm w-full max-w-xs"
                              showToday
                              disabled={resetting}
                            />
                            <p className="text-[11px] text-security-navy-500 dark:text-security-navy-400 mt-0.5">
                              Leave empty to reset all attendance. Set a date to reset only from that date onwards.
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-security-navy-600 dark:text-security-navy-400 mb-1">
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
                            <p className="text-[11px] text-security-navy-500 dark:text-security-navy-400 mt-0.5">
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
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">
            Type <strong>{CONFIRM_PHRASE}</strong> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            className="input-modern font-mono max-w-md mx-auto"
            placeholder={CONFIRM_PHRASE}
            disabled={resetting}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-security-navy-700 dark:text-security-navy-300 mb-1">
            Confirm your current password
          </label>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="input-modern max-w-md mx-auto"
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

        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleReset}
            disabled={!canReset}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-security-navy-300 disabled:cursor-not-allowed rounded-sm transition-colors"
          >
            {resetting ? "Resetting..." : "Factory Reset"}
          </button>
        </div>
      </div>
    </div>
  );
}
