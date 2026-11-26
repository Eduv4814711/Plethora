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
  listPublicHolidays,
  createPublicHoliday,
  deletePublicHoliday,
  authFetch,
  type AccountType,
  type PublicHolidayItem,
  type Capability,
  type CapabilityDefinition,
  type CapabilityMap,
  type UserListItem,
  type FactoryResetModuleId,
  type AuthUser,
} from "@/lib/api";
import { canAccessMigrationTools, hasCapability } from "@/lib/permissions";
import { DateInput } from "@/components/date-input";
import { AlertBanner, PageHeader, PageShell, SkeletonBlock, useConfirmDialog } from "@/components/ui";
import { ClientsSettingsSection } from "@/components/clients-settings-section";
import { CapabilityUsersSection } from "@/components/capability-users-section";
import { clsx } from "clsx";

type Tab = "profile" | "business" | "settings" | "holidays" | "users" | "clients" | "migrate" | "factory_reset";

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
  const tabIds: Tab[] = ["profile", "business", "settings", "holidays", "users", "clients", "migrate", "factory_reset"];
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
    { id: "holidays", label: "Public Holidays" },
    { id: "users", label: "User Access", visible: canViewAccess },
    { id: "clients", label: "Clients", visible: canManageClients },
    { id: "migrate", label: "Bulk Import/Export", visible: canUseMigrationTools, href: "/settings/migrate" },
    { id: "factory_reset", label: "Factory Reset", visible: isOwner },
  ];

  if (loading && !settings) {
    return (
      <PageShell>
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-64" />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Manage your profile, company details, users, and system options."
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {!canEditSettings && activeTab !== "profile" && activeTab !== "users" && (
        <AlertBanner variant="info">
          Your current access is read-only for company settings.
        </AlertBanner>
      )}

      <div className="flex gap-1 border-b border-security-navy-100 overflow-x-auto">
        {tabs
          .filter((t) => t.visible !== false)
          .map((tab) => {
            const tabProps = {
              className: clsx(
                "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                activeTab === tab.id
                  ? "border-security-amber-500 text-security-navy-950 font-semibold"
                  : "border-transparent text-security-navy-500 hover:text-security-navy-900"
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
        {activeTab === "holidays" && token && (
          <PublicHolidaysSection token={token} readOnly={!canEditSettings} />
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
    </PageShell>
  );
}

function ProfileSection({ user }: { user: AuthUser | null }) {
  return (
    <div className="text-left">
      <h3 className="font-semibold text-security-navy-900 mb-4">Profile</h3>
      <dl className="space-y-3 text-sm text-left">
        <div>
          <dt className="text-security-navy-500">Name</dt>
          <dd className="text-security-navy-900">{user?.name}</dd>
        </div>
        <div>
          <dt className="text-security-navy-500">Email</dt>
          <dd className="text-security-navy-900">{user?.email}</dd>
        </div>
        <div>
          <dt className="text-security-navy-500">Account</dt>
          <dd className="text-security-navy-900">
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
      <h3 className="font-semibold text-security-navy-900 mb-4">Business Details</h3>
      <p className="text-sm text-security-navy-500 mb-6">
        Configure your company information. This is used across the system (invoices, reports, etc.).
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Company Name</label>
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Legal Name</label>
          <input
            type="text"
            value={form.legalName}
            onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
            className="input-modern"
            placeholder="Quick Bopha Security (Pty) Ltd"
            readOnly={readOnly}
          />
        </div>
        <div className="border-t border-security-navy-100 pt-6 mt-6">
          <h4 className="text-sm font-medium text-security-navy-700 mb-4">Company Statutory &amp; Registration Numbers</h4>
          <p className="text-xs text-security-navy-500 mb-4">
            Used on client billing documents, tender compliance packs, and external payroll exports (Sage).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-security-navy-700 mb-1">PSIRA Registration</label>
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">Company Registration</label>
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">Tax Number</label>
              <input
                type="text"
                value={form.taxNumber}
                onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))}
                className="input-modern"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-security-navy-700 mb-1">UIF Reference</label>
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">PAYE Reference</label>
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">SDL Reference</label>
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">Telephone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="input-modern"
                readOnly={readOnly}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-security-navy-700 mb-1">Fax</label>
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">Email</label>
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Address</label>
          <textarea
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className="input-modern min-h-[80px]"
            rows={3}
            readOnly={readOnly}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Website</label>
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
          <p className="text-sm text-red-600">{saveError}</p>
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
  onSave: (data: Record<string, string | number | boolean | null | undefined | RosterPeriodCalendarConfig[]>) => Promise<void>;
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
    adminGeofenceEnabled: true,
    adminOfficeName: "",
    adminOfficeLatitude: "",
    adminOfficeLongitude: "",
    adminGeofenceRadiusMeters: "200",
    obBookMode: "REQUIRED" as "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL",
    psiraEnforcementMode: "WARN" as "BLOCK" | "WARN" | "OFF",
    averagingEnabled: false,
    averagingWeeks: "4",
    overnightBoundaryMode: "shift_start_day" as "shift_start_day" | "midnight_split",
    sundayDoubleRateSplit: false,
    fortnightlyRestEnabled: false,
  });
  const [geoDetecting, setGeoDetecting] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

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
        adminGeofenceEnabled: s.adminGeofenceEnabled ?? true,
        adminOfficeName: s.adminOfficeName ?? "",
        adminOfficeLatitude: s.adminOfficeLatitude != null ? String(s.adminOfficeLatitude) : "",
        adminOfficeLongitude: s.adminOfficeLongitude != null ? String(s.adminOfficeLongitude) : "",
        adminGeofenceRadiusMeters: s.adminGeofenceRadiusMeters != null ? String(s.adminGeofenceRadiusMeters) : "200",
        obBookMode: s.obBookMode ?? "REQUIRED",
        psiraEnforcementMode: s.psiraEnforcementMode ?? "WARN",
        averagingEnabled: Boolean(s.averagingEnabled),
        averagingWeeks: String(s.averagingWeeks ?? 4),
        overnightBoundaryMode: s.overnightBoundaryMode ?? "shift_start_day",
        sundayDoubleRateSplit: Boolean(s.sundayDoubleRateSplit),
        fortnightlyRestEnabled: Boolean(s.fortnightlyRestEnabled),
      });
    }
  }, [settings?.settings]);

  const handleUseCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }
    setGeoDetecting(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          adminOfficeLatitude: pos.coords.latitude.toFixed(7),
          adminOfficeLongitude: pos.coords.longitude.toFixed(7),
          adminGeofenceRadiusMeters: f.adminGeofenceRadiusMeters || "200",
          adminOfficeName: f.adminOfficeName || "Head Office",
        }));
        setGeoDetecting(false);
      },
      (err) => {
        setGeoError(`Unable to retrieve GPS location: ${err.message}`);
        setGeoDetecting(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleClearGeo = () => {
    setForm((f) => ({
      ...f,
      adminOfficeLatitude: "",
      adminOfficeLongitude: "",
    }));
    setGeoError(null);
  };

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

    const latStr = form.adminOfficeLatitude.trim();
    const lngStr = form.adminOfficeLongitude.trim();
    if ((latStr && !lngStr) || (!latStr && lngStr)) {
      setGeoError("Both Latitude and Longitude are required together (or clear both).");
      return;
    }
    let latNum: number | null = null;
    let lngNum: number | null = null;
    let radiusNum: number | null = null;
    if (latStr && lngStr) {
      latNum = parseFloat(latStr);
      lngNum = parseFloat(lngStr);
      radiusNum = parseInt(form.adminGeofenceRadiusMeters, 10);
      if (Number.isNaN(latNum) || latNum < -90 || latNum > 90) {
        setGeoError("Latitude must be a valid number between -90 and 90.");
        return;
      }
      if (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
        setGeoError("Longitude must be a valid number between -180 and 180.");
        return;
      }
      if (Number.isNaN(radiusNum) || radiusNum < 10 || radiusNum > 100000) {
        setGeoError("Geofence radius must be between 10 and 100,000 meters.");
        return;
      }
    }
    setGeoError(null);

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
      adminGeofenceEnabled: form.adminGeofenceEnabled,
      adminOfficeName: form.adminOfficeName.trim() || null,
      adminOfficeLatitude: latNum,
      adminOfficeLongitude: lngNum,
      adminGeofenceRadiusMeters: radiusNum ?? (latNum != null ? 200 : null),
      obBookMode: form.obBookMode,
      psiraEnforcementMode: form.psiraEnforcementMode,
      averagingEnabled: form.averagingEnabled,
      averagingWeeks: Math.max(2, Math.min(16, parseInt(form.averagingWeeks, 10) || 4)),
      overnightBoundaryMode: form.overnightBoundaryMode,
      sundayDoubleRateSplit: form.sundayDoubleRateSplit,
      fortnightlyRestEnabled: form.fortnightlyRestEnabled,
    });
  };

  const hasGeoCoords = Boolean(form.adminOfficeLatitude.trim() && form.adminOfficeLongitude.trim());

  return (
    <div>
      <h3 className="font-semibold text-security-navy-900 mb-4">Business Settings</h3>
      <p className="text-sm text-security-navy-500 mb-6">
        Configure defaults used for rostering cycles, attendance, export schedules, and reporting.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Currency</label>
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Date Format</label>
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Timezone</label>
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Payroll export frequency</label>
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
          <p className="text-xs text-security-navy-500 mt-1">
            Labeling cadence for external payroll export cycles. Period date bounds are configured below.
          </p>
        </div>
        <div className="rounded-security-lg border border-security-amber-200/80 bg-security-amber-50/40 p-4 space-y-3">
          <p className="text-sm font-medium text-security-navy-900">Export &amp; roster period calendar</p>
          <p className="text-xs text-security-navy-500">
            Example: start 26, end 25 → 26 Jun–25 Jul is labelled <strong>July</strong> pay/roster period.
            Auto-roster maintains shifts through N pay periods ahead.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-security-navy-700 mb-1">
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
              <label className="block text-sm font-medium text-security-navy-700 mb-1">
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
            <label className="block text-sm font-medium text-security-navy-700 mb-1">
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
        <div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50/60 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-security-navy-900">Roster period calendars</p>
            <p className="text-xs text-security-navy-500 mt-1">
              Add different period date ranges for roster planning. Use start ≤ end for one calendar month
              (e.g. 1–31). Use start &gt; end for cross-month periods (e.g. 26–25). Export batches still use
              the main period dates above.
            </p>
          </div>
          <div className="space-y-3">
            {form.rosterPeriodCalendars.map((calendar, index) => (
              <div
                key={calendar.id}
                className="rounded-lg border border-security-navy-100 bg-white p-3 space-y-2"
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
                  <label className="inline-flex items-center gap-1.5 text-xs text-security-navy-600">
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
                    <label className="block text-xs font-medium text-security-navy-600 mb-1">
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
                    <label className="block text-xs font-medium text-security-navy-600 mb-1">
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

        {/* Admin & Office Staff Geofence Configuration */}
        <div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50/60 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h4 className="text-sm font-medium text-security-navy-900 flex items-center gap-2">
                <span>📍 Admin &amp; Office Staff Geofence</span>
                {hasGeoCoords ? (
                  form.adminGeofenceEnabled ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Active ({form.adminGeofenceRadiusMeters || 200}m)
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                      Disabled
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                    Not Configured
                  </span>
                )}
              </h4>
              <p className="text-xs text-security-navy-500 mt-1">
                Central geolocation coordinates for administrative and head office staff clocking in/out via WhatsApp.
              </p>
            </div>
            {!readOnly && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  disabled={geoDetecting || saving}
                  className="text-xs font-medium px-2.5 py-1.5 rounded border border-security-navy-200 text-security-navy-700 hover:bg-white transition-colors shadow-sm"
                >
                  {geoDetecting ? "Locating…" : "📍 Pin Current Location"}
                </button>
                {hasGeoCoords && (
                  <button
                    type="button"
                    onClick={handleClearGeo}
                    disabled={saving}
                    className="text-xs font-medium px-2 py-1 text-red-600 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {geoError && (
            <div className="p-3 text-xs text-red-700 bg-red-50 rounded-lg border border-red-200">
              {geoError}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="adminGeofenceEnabled"
                checked={form.adminGeofenceEnabled}
                onChange={(e) => setForm((f) => ({ ...f, adminGeofenceEnabled: e.target.checked }))}
                disabled={readOnly}
                className="rounded border-security-navy-300 text-security-navy-600 focus:ring-security-navy-500"
              />
              <label htmlFor="adminGeofenceEnabled" className="text-sm text-security-navy-800 cursor-pointer">
                Enforce geofence verification for admin staff clocking via WhatsApp
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-security-navy-700 mb-1">
                Office / HQ Label
              </label>
              <input
                type="text"
                value={form.adminOfficeName}
                onChange={(e) => setForm((f) => ({ ...f, adminOfficeName: e.target.value }))}
                className="input-modern w-full"
                placeholder="e.g. Head Office / Corporate HQ"
                disabled={readOnly}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-security-navy-700 mb-1">
                  Latitude (WGS84)
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.adminOfficeLatitude}
                  onChange={(e) => setForm((f) => ({ ...f, adminOfficeLatitude: e.target.value }))}
                  className="input-modern w-full"
                  placeholder="-26.1952400"
                  disabled={readOnly}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-security-navy-700 mb-1">
                  Longitude (WGS84)
                </label>
                <input
                  type="number"
                  step="any"
                  value={form.adminOfficeLongitude}
                  onChange={(e) => setForm((f) => ({ ...f, adminOfficeLongitude: e.target.value }))}
                  className="input-modern w-full"
                  placeholder="28.0345600"
                  disabled={readOnly}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-security-navy-700 mb-1">
                  Radius (meters)
                </label>
                <input
                  type="number"
                  min={10}
                  max={100000}
                  value={form.adminGeofenceRadiusMeters}
                  onChange={(e) => setForm((f) => ({ ...f, adminGeofenceRadiusMeters: e.target.value }))}
                  className="input-modern w-full"
                  placeholder="200"
                  disabled={readOnly}
                />
              </div>
            </div>

            {hasGeoCoords && (
              <div className="flex items-center justify-between text-xs text-security-navy-500 pt-1">
                <span>
                  Coordinates: {form.adminOfficeLatitude}, {form.adminOfficeLongitude}
                </span>
                <a
                  href={`https://www.google.com/maps?q=${form.adminOfficeLatitude},${form.adminOfficeLongitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-security-navy-600 hover:underline flex items-center gap-1 font-medium"
                >
                  🗺️ View on Google Maps ↗
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 rounded-xl bg-security-navy-50/70 border border-security-navy-200 space-y-4">
          <div>
            <h4 className="font-semibold text-sm text-security-navy-900">
              South African Labour &amp; Operations Rules (NBCPSS / BCEA / PSIRA)
            </h4>
            <p className="text-xs text-security-navy-500 mt-1">
              Applies Sector 6 private security rules (48h/week ordinary cap, 12h daily max, Sunday &amp; Public Holiday rates, night allowance) and default Occurrence Book policy across sites.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-security-navy-700 mb-1">
                Default Occurrence Book (OB) Policy
              </label>
              <select
                value={form.obBookMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    obBookMode: e.target.value as "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL",
                  }))
                }
                className="input-modern w-full"
                disabled={readOnly}
              >
                <option value="REQUIRED">Always Required (Traditional OB Book)</option>
                <option value="OPTIONAL_WHEN_DIGITAL">Optional when clocked via App/WhatsApp</option>
                <option value="OPTIONAL">Optional / Digital Only (No OB Required)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-security-navy-700 mb-1">
                PSIRA Registration &amp; Grade Check
              </label>
              <select
                value={form.psiraEnforcementMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    psiraEnforcementMode: e.target.value as "BLOCK" | "WARN" | "OFF",
                  }))
                }
                className="input-modern w-full"
                disabled={readOnly}
              >
                <option value="WARN">Warn on expired/missing PSIRA (Recommended)</option>
                <option value="BLOCK">Block rostering expired/under-graded guards</option>
                <option value="OFF">Off</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-security-navy-700 mb-1">
                Overnight Shift Date Boundary
              </label>
              <select
                value={form.overnightBoundaryMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    overnightBoundaryMode: e.target.value as "shift_start_day" | "midnight_split",
                  }))
                }
                className="input-modern w-full"
                disabled={readOnly}
              >
                <option value="shift_start_day">Full shift on start date (SA NBCPSS Standard)</option>
                <option value="midnight_split">Split hours at midnight (Sun/Holiday pro-rata)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-security-navy-700 mb-1">
                BCEA s12 Averaging Cycle (weeks)
              </label>
              <input
                type="number"
                min={2}
                max={16}
                value={form.averagingWeeks}
                onChange={(e) => setForm((f) => ({ ...f, averagingWeeks: e.target.value }))}
                className="input-modern w-full"
                disabled={readOnly || !form.averagingEnabled}
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 text-xs text-security-navy-800 cursor-pointer">
              <input
                type="checkbox"
                checked={form.averagingEnabled}
                onChange={(e) => setForm((f) => ({ ...f, averagingEnabled: e.target.checked }))}
                disabled={readOnly}
                className="rounded border-security-navy-300 text-security-navy-600 focus:ring-security-navy-500"
              />
              Enable BCEA s12 hours averaging agreement (up to 4 weeks/cycle for 4-on/4-off shifts)
            </label>
            <label className="flex items-center gap-2 text-xs text-security-navy-800 cursor-pointer">
              <input
                type="checkbox"
                checked={form.sundayDoubleRateSplit}
                onChange={(e) => setForm((f) => ({ ...f, sundayDoubleRateSplit: e.target.checked }))}
                disabled={readOnly}
                className="rounded border-security-navy-300 text-security-navy-600 focus:ring-security-navy-500"
              />
              Split Sunday 1.5x (scheduled) vs Sunday 2.0x (unscheduled reliever) on payroll export
            </label>
            <label className="flex items-center gap-2 text-xs text-security-navy-800 cursor-pointer">
              <input
                type="checkbox"
                checked={form.fortnightlyRestEnabled}
                onChange={(e) => setForm((f) => ({ ...f, fortnightlyRestEnabled: e.target.checked }))}
                disabled={readOnly}
                className="rounded border-security-navy-300 text-security-navy-600 focus:ring-security-navy-500"
              />
              Use BCEA 60h fortnightly rest agreement (instead of 36h every 7 days)
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-security-navy-700 mb-1">Team Member ID Prefix</label>
          <input
            type="text"
            value={form.employeeIdPrefix}
            onChange={(e) => setForm((f) => ({ ...f, employeeIdPrefix: e.target.value.toUpperCase() }))}
            className="input-modern"
            placeholder="EMP"
            maxLength={20}
            disabled={readOnly}
          />
          <p className="text-xs text-security-navy-500 mt-1">
            Prefix for auto-generated team member IDs (e.g. EMP-0001, STAFF-0001)
          </p>
        </div>
        {saveError && (
          <p className="text-sm text-red-600">{saveError}</p>
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
      <h3 className="font-semibold text-security-navy-900 mb-4">Factory Reset</h3>
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="p-4 rounded-sm border border-red-200 bg-red-50">
          <p className="text-sm text-red-800 font-medium mb-2">
            This action cannot be undone.
          </p>
          <p className="text-sm text-red-700">
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
              className="rounded border-security-navy-200"
            />
            <label
              htmlFor="reset-all"
              className="text-sm font-medium text-security-navy-900 cursor-pointer"
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
                  className="text-xs text-security-navy-600 hover:text-security-navy-900 underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-xs text-security-navy-600 hover:text-security-navy-900 underline"
                >
                  Deselect all
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 text-left">
                {FACTORY_RESET_MODULES.map((mod) => (
                  <div
                    key={mod.id}
                    className={clsx(
                      "flex items-start gap-2 p-2 rounded-sm border border-security-navy-100",
                      mod.id === "attendance" && "sm:col-span-2"
                    )}
                  >
                    <input
                      type="checkbox"
                      id={`mod-${mod.id}`}
                      checked={selectedModules.has(mod.id)}
                      onChange={() => toggleModule(mod.id)}
                      disabled={resetting}
                      className="mt-0.5 rounded border-security-navy-200"
                    />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={`mod-${mod.id}`}
                        className="text-sm cursor-pointer block"
                      >
                        <span className="font-medium text-security-navy-900">
                          {mod.label}
                        </span>
                        <span className="block text-xs text-security-navy-500 mt-0.5">
                          {mod.description}
                        </span>
                      </label>
                      {mod.id === "attendance" && selectedModules.has("attendance") && (
                        <div className="mt-2 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-security-navy-600 mb-1">
                              Reset from date (optional)
                            </label>
                            <DateInput
                              value={attendanceFromDate}
                              onChange={setAttendanceFromDate}
                              className="input-modern py-1.5 text-sm w-full max-w-xs"
                              showToday
                              disabled={resetting}
                            />
                            <p className="text-[11px] text-security-navy-500 mt-0.5">
                              Leave empty to reset all attendance. Set a date to reset only from that date onwards.
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-security-navy-600 mb-1">
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
                            <p className="text-[11px] text-security-navy-500 mt-0.5">
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">
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
          <label className="block text-sm font-medium text-security-navy-700 mb-1">
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
          <p className="text-sm text-red-600">{error}</p>
        )}

        {success && (
          <p className="text-sm text-security-navy-600">
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

function PublicHolidaysSection({ token, readOnly }: { token: string; readOnly: boolean }) {
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [holidays, setHolidays] = useState<PublicHolidayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPublicHolidays(token, year);
      setHolidays(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load public holidays");
    } finally {
      setLoading(false);
    }
  }, [token, year]);

  useEffect(() => {
    void loadHolidays();
  }, [loadHolidays]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPublicHoliday(token, { date: date.trim(), name: name.trim() });
      setDate("");
      setName("");
      await loadHolidays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add public holiday");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await deletePublicHoliday(token, id);
      await loadHolidays();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete public holiday");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-security-navy-900">Public Holidays</h3>
          <p className="text-xs text-security-navy-500 mt-0.5">
            Dates configured here classify worked attendance into Public Holiday hours for client billing and Sage exports.
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="input-modern w-auto"
          aria-label="Filter public holidays by year"
        >
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-sm">
          {error}
        </div>
      )}

      {!readOnly && (
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl items-end">
          <div>
            <label className="block text-xs font-medium text-security-navy-700 mb-1">
              Date
            </label>
            <DateInput value={date} onChange={setDate} className="input-modern" />
          </div>
          <div>
            <label className="block text-xs font-medium text-security-navy-700 mb-1">
              Holiday Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Human Rights Day"
              className="input-modern"
              required
            />
          </div>
          <div>
            <button type="submit" disabled={submitting} className="btn-primary w-full sm:w-auto">
              {submitting ? "Adding..." : "Add Public Holiday"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-security-navy-500">Loading public holidays...</p>
      ) : holidays.length === 0 ? (
        <p className="text-sm text-security-navy-500">No public holidays configured for {year}.</p>
      ) : (
        <div className="overflow-x-auto border border-security-navy-100 rounded-security">
          <table className="min-w-full divide-y divide-security-navy-100 text-sm">
            <thead className="bg-security-navy-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-security-navy-600 uppercase">Date</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-security-navy-600 uppercase">Holiday</th>
                {!readOnly && <th className="px-4 py-2 text-right text-xs font-semibold text-security-navy-600 uppercase">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-security-navy-100">
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2 font-mono text-security-navy-900">
                    {String(h.date).slice(0, 10)}
                  </td>
                  <td className="px-4 py-2 text-security-navy-800">
                    {h.name || "Public Holiday"}
                  </td>
                  {!readOnly && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(h.id)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
