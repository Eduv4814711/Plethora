"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  createExportBatch,
  createExportProfile,
  deleteDraftExportBatch,
  deleteExportProfile,
  downloadExportBatchFile,
  downloadSageEmployeeMasterCsv,
  getExportBatchDetail,
  listExportBatches,
  listExportPeriods,
  listExportProfiles,
  lockExportBatch,
  previewPayrollExport,
  updateExportProfile,
  voidExportBatch,
  type ExportPreviewResponse,
  type ExportPeriodOption,
  type PayCodeMapping,
  type PayrollExportBatch,
  type PayrollExportProfile,
  type PayrollExportProvider,
} from "@/lib/payroll-export-api";
import { AlertBanner, Badge, Button, Card, EmptyState, PageHeader, useConfirmDialog } from "@/components/ui";

type TabKey = "cycle" | "history" | "profiles";

const PROVIDER_LABELS: Record<PayrollExportProvider, string> = {
  SAGE_BUSINESS_CLOUD_ZA: "Sage Business Cloud Payroll ZA",
  SAGE_VIP: "Sage VIP / Premier CSV",
  SAGE_300_PEOPLE: "Sage 300 People Batch",
  GENERIC_CSV: "Generic Wide CSV",
  JSON_WEBHOOK: "Structured JSON Payload",
};

const DEFAULT_CODES: Required<PayCodeMapping> = {
  regularHours: "1000",
  overtimeHours: "1010",
  sundayHours: "1020",
  publicHolidayHours: "1030",
  nightShiftHours: "1040",
  annualLeaveHours: "2000",
  sickLeaveHours: "2010",
  familyLeaveHours: "2020",
  studyLeaveHours: "2030",
  unpaidLeaveHours: "2090",
};

const CODE_FIELDS: Array<{ key: keyof PayCodeMapping; label: string }> = [
  { key: "regularHours", label: "Basic / Ordinary Hours" },
  { key: "overtimeHours", label: "Overtime 1.5x Hours" },
  { key: "sundayHours", label: "Sunday Hours" },
  { key: "publicHolidayHours", label: "Public Holiday Hours" },
  { key: "nightShiftHours", label: "Night Shift Allowance Hours" },
  { key: "annualLeaveHours", label: "Annual Leave Hours" },
  { key: "sickLeaveHours", label: "Sick Leave Hours" },
  { key: "familyLeaveHours", label: "Family Leave Hours" },
  { key: "studyLeaveHours", label: "Study Leave Hours" },
  { key: "unpaidLeaveHours", label: "Unpaid Leave Hours" },
];

function num(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function batchBadgeVariant(status: string): "neutral" | "warning" | "success" | "error" {
  switch (status) {
    case "EXPORTED":
      return "success";
    case "LOCKED":
      return "warning";
    case "VOIDED":
      return "error";
    default:
      return "neutral";
  }
}

export default function PayrollExportsPage() {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();

  const canCreate = Boolean(user && hasCapability(user, "/payroll-exports", "create"));
  const canEdit = Boolean(user && hasCapability(user, "/payroll-exports", "edit"));
  const canApprove = Boolean(user && hasCapability(user, "/payroll-exports", "approve"));
  const canExport = Boolean(user && hasCapability(user, "/payroll-exports", "export"));
  const canExportSensitiveEmployees = Boolean(
    user &&
      hasCapability(user, "/payroll-exports", "export") &&
      hasCapability(user, "/employees", "view_sensitive")
  );

  const [tab, setTab] = useState<TabKey>("cycle");
  const [periods, setPeriods] = useState<ExportPeriodOption[]>([]);
  const [profiles, setProfiles] = useState<PayrollExportProfile[]>([]);
  const [batches, setBatches] = useState<PayrollExportBatch[]>([]);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [splitBySite, setSplitBySite] = useState<boolean>(true);

  const [preview, setPreview] = useState<ExportPreviewResponse | null>(null);
  const [showRawPreview, setShowRawPreview] = useState(false);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState<PayrollExportBatch | null>(null);

  const [loadingInit, setLoadingInit] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modals / prompts
  const [lockModalBatch, setLockModalBatch] = useState<{
    id: string;
    hasBlockers: boolean;
    blockers: string[];
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const [voidModalBatch, setVoidModalBatch] = useState<PayrollExportBatch | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // Profile editor state
  const [editingProfile, setEditingProfile] = useState<PayrollExportProfile | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    provider: "SAGE_BUSINESS_CLOUD_ZA" as PayrollExportProvider,
    isDefault: false,
    splitBySite: true,
    delimiter: ",",
    dateFormat: "yyyy-MM-dd",
    codeMappingJson: { ...DEFAULT_CODES } as PayCodeMapping,
  });

  const loadMetadata = useCallback(async () => {
    if (!token) return;
    setLoadingInit(true);
    setError("");
    try {
      const [periodList, profileList, batchList] = await Promise.all([
        listExportPeriods(token),
        listExportProfiles(token),
        listExportBatches(token),
      ]);
      setPeriods(periodList);
      setProfiles(profileList);
      setBatches(batchList);

      const currentPeriod = periodList.find((p) => p.isCurrent) ?? periodList[0];
      const defaultProfile = profileList.find((p) => p.isDefault) ?? profileList[0];

      setSelectedPeriodKey((prev) => prev || currentPeriod?.periodKey || "");
      if (defaultProfile) {
        setSelectedProfileId((prev) => prev || defaultProfile.id);
        setSplitBySite(defaultProfile.splitBySite);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payroll export module");
    } finally {
      setLoadingInit(false);
    }
  }, [token]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  const loadPreview = useCallback(async () => {
    if (!token || !selectedPeriodKey || !selectedProfileId) return;
    setLoadingPreview(true);
    setError("");
    try {
      const data = await previewPayrollExport(token, {
        periodKey: selectedPeriodKey,
        profileId: selectedProfileId,
        splitBySite,
      });
      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cycle preview");
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [token, selectedPeriodKey, selectedProfileId, splitBySite]);

  useEffect(() => {
    if (!loadingInit && selectedPeriodKey && selectedProfileId) {
      void loadPreview();
    }
  }, [loadingInit, selectedPeriodKey, selectedProfileId, splitBySite, loadPreview]);

  const periodBatches = useMemo(
    () => batches.filter((b) => b.periodKey === selectedPeriodKey),
    [batches, selectedPeriodKey]
  );

  const activeCycleBatch = useMemo(
    () => periodBatches.find((b) => b.status !== "VOIDED") ?? null,
    [periodBatches]
  );

  const handleProfileSelectionChange = (profileId: string) => {
    setSelectedProfileId(profileId);
    const prof = profiles.find((p) => p.id === profileId);
    if (prof) setSplitBySite(prof.splitBySite);
  };

  const handleCreateSnapshot = async () => {
    if (!token || !canCreate) return;
    setBusyAction("create-batch");
    setError("");
    setNotice("");
    try {
      const created = await createExportBatch(token, {
        periodKey: selectedPeriodKey,
        profileId: selectedProfileId,
        splitBySite,
      });
      setNotice(`Created draft snapshot (${created.employeeCount} team members). Review and lock to export.`);
      const updatedBatches = await listExportBatches(token);
      setBatches(updatedBatches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create draft batch");
    } finally {
      setBusyAction(null);
    }
  };

  const openLockModal = (batchId: string) => {
    setOverrideReason("");
    setLockModalBatch({
      id: batchId,
      hasBlockers: Boolean(preview?.blockers.length),
      blockers: preview?.blockers ?? [],
    });
  };

  const handleConfirmLock = async () => {
    if (!token || !lockModalBatch) return;
    if (lockModalBatch.hasBlockers && overrideReason.trim().length < 5) {
      setError("Please enter an override reason (minimum 5 characters) because blockers remain open.");
      return;
    }
    setBusyAction(`lock:${lockModalBatch.id}`);
    setError("");
    setNotice("");
    try {
      const locked = await lockExportBatch(
        token,
        lockModalBatch.id,
        overrideReason.trim() || undefined
      );
      setLockModalBatch(null);
      setOverrideReason("");
      setNotice(`Batch ${locked.periodKey} locked. Approved site timesheets and leave have been frozen.`);
      const [updatedBatches] = await Promise.all([listExportBatches(token), loadPreview()]);
      setBatches(updatedBatches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to lock export batch");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadBatch = async (batch: PayrollExportBatch) => {
    if (!token || !canExport) return;
    setBusyAction(`download:${batch.id}`);
    setError("");
    setNotice("");
    try {
      await downloadExportBatchFile(token, batch.id);
      setNotice(`Downloaded ${PROVIDER_LABELS[batch.profile.provider]} file for ${batch.periodKey}.`);
      const updatedBatches = await listExportBatches(token);
      setBatches(updatedBatches);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download export batch");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteDraft = async (batch: PayrollExportBatch) => {
    if (!token || !canEdit) return;
    const ok = await confirm({
      title: "Delete draft batch",
      message: `Delete draft export snapshot for ${batch.periodKey}? You can regenerate a fresh snapshot at any time.`,
      confirmLabel: "Delete draft",
      danger: true,
    });
    if (!ok) return;
    setBusyAction(`delete:${batch.id}`);
    setError("");
    try {
      await deleteDraftExportBatch(token, batch.id);
      setBatches(await listExportBatches(token));
      setNotice("Draft batch deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft");
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmVoid = async () => {
    if (!token || !voidModalBatch) return;
    if (voidReason.trim().length < 5) {
      setError("Void reason must be at least 5 characters.");
      return;
    }
    setBusyAction(`void:${voidModalBatch.id}`);
    setError("");
    try {
      await voidExportBatch(token, voidModalBatch.id, voidReason.trim());
      setVoidModalBatch(null);
      setVoidReason("");
      setBatches(await listExportBatches(token));
      setNotice("Batch voided and linked leave records released for re-export.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to void batch");
    } finally {
      setBusyAction(null);
    }
  };

  const handleInspectBatch = async (batchId: string) => {
    if (!token) return;
    setBusyAction(`inspect:${batchId}`);
    setError("");
    try {
      const detail = await getExportBatchDetail(token, batchId);
      setSelectedBatchDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load batch lines");
    } finally {
      setBusyAction(null);
    }
  };

  const startNewProfile = () => {
    setEditingProfile(null);
    setProfileForm({
      name: "",
      provider: "SAGE_BUSINESS_CLOUD_ZA",
      isDefault: false,
      splitBySite: true,
      delimiter: ",",
      dateFormat: "yyyy-MM-dd",
      codeMappingJson: { ...DEFAULT_CODES },
    });
    setShowProfileForm(true);
  };

  const startEditProfile = (profile: PayrollExportProfile) => {
    setEditingProfile(profile);
    setProfileForm({
      name: profile.name,
      provider: profile.provider,
      isDefault: profile.isDefault,
      splitBySite: profile.splitBySite,
      delimiter: profile.delimiter || ",",
      dateFormat: profile.dateFormat || "yyyy-MM-dd",
      codeMappingJson: { ...DEFAULT_CODES, ...(profile.codeMappingJson ?? {}) },
    });
    setShowProfileForm(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !canEdit) return;
    setBusyAction("save-profile");
    setError("");
    try {
      if (editingProfile) {
        await updateExportProfile(token, editingProfile.id, profileForm);
        setNotice("Export profile updated.");
      } else {
        await createExportProfile(token, profileForm);
        setNotice("Export profile created.");
      }
      setShowProfileForm(false);
      setEditingProfile(null);
      setProfiles(await listExportProfiles(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteProfile = async (profile: PayrollExportProfile) => {
    if (!token || !canEdit) return;
    const ok = await confirm({
      title: "Delete export profile",
      message: `Delete "${profile.name}"?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusyAction(`del-profile:${profile.id}`);
    setError("");
    try {
      await deleteExportProfile(token, profile.id);
      setProfiles(await listExportProfiles(token));
      setNotice("Export profile deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete profile");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadEmployeeMaster = async () => {
    if (!token || !canExportSensitiveEmployees) return;
    setBusyAction("employee-master");
    setError("");
    try {
      await downloadSageEmployeeMasterCsv(token);
      setNotice("Sage Employee Master CSV downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export employee master CSV");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {confirmDialog}

      <PageHeader
        title="External Payroll Export (Sage / CSV)"
        description="Prepare locked, auditable timesheet and approved leave batches from Plethora actual attendance for Sage Business Cloud, Sage VIP, Sage 300 People, or CSV."
        actions={
          canExportSensitiveEmployees ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDownloadEmployeeMaster()}
              disabled={busyAction === "employee-master"}
            >
              {busyAction === "employee-master"
                ? "Exporting..."
                : "Download Employee Master CSV"}
            </Button>
          ) : undefined
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}
      {notice && <AlertBanner variant="success">{notice}</AlertBanner>}

      <div className="flex gap-1 border-b border-security-navy-100">
        {(
          [
            { id: "cycle", label: "Export Cycle (26th–25th)" },
            { id: "history", label: `Export History (${batches.length})` },
            { id: "profiles", label: `Profiles & Sage Mapping (${profiles.length})` },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === item.id
                ? "border-security-amber-500 text-security-navy-900 bg-white"
                : "border-transparent text-security-navy-500 hover:text-security-navy-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loadingInit ? (
        <Card className="p-8 text-center text-sm text-security-navy-500">
          Loading cycles and export profiles...
        </Card>
      ) : null}

      {/* TAB 1: EXPORT CYCLE */}
      {!loadingInit && tab === "cycle" && (
        <div className="space-y-5">
          <Card className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-security-navy-600 mb-1">
                  Export Cycle
                </label>
                <select
                  value={selectedPeriodKey}
                  onChange={(e) => setSelectedPeriodKey(e.target.value)}
                  className="input-modern"
                >
                  {periods.map((p) => (
                    <option key={p.periodKey} value={p.periodKey}>
                      {p.label} ({p.periodStart} to {p.periodEnd}){p.isCurrent ? " · Current" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-security-navy-600 mb-1">
                  Target Format / Profile
                </label>
                <select
                  value={selectedProfileId}
                  onChange={(e) => handleProfileSelectionChange(e.target.value)}
                  className="input-modern"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isDefault ? "(Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <input
                  id="split-by-site-toggle"
                  type="checkbox"
                  checked={splitBySite}
                  onChange={(e) => setSplitBySite(e.target.checked)}
                  className="rounded border-security-navy-300"
                />
                <label htmlFor="split-by-site-toggle" className="text-sm text-security-navy-800 cursor-pointer">
                  Split multi-site hours by Cost Centre
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadPreview()}
                  disabled={loadingPreview}
                >
                  {loadingPreview ? "Refreshing..." : "Refresh Hours"}
                </Button>
                {canCreate && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleCreateSnapshot()}
                    disabled={
                      busyAction === "create-batch" ||
                      loadingPreview ||
                      !preview ||
                      preview.lines.length === 0
                    }
                  >
                    {busyAction === "create-batch" ? "Creating..." : "Create Snapshot"}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Active Batch Bar for selected cycle */}
          {activeCycleBatch && (
            <Card className="p-4 border-security-amber-200 bg-security-amber-50/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Badge variant={batchBadgeVariant(activeCycleBatch.status)}>
                    {activeCycleBatch.status}
                  </Badge>
                  <div className="text-sm">
                    <span className="font-semibold text-security-navy-900">
                      Snapshot {activeCycleBatch.periodKey}
                    </span>
                    <span className="text-security-navy-600 ml-2">
                      {activeCycleBatch.employeeCount} employees · {activeCycleBatch.profile.name}
                    </span>
                    {activeCycleBatch.checksumSha256 && (
                      <span className="ml-2 font-mono text-xs text-security-navy-500">
                        SHA256: {activeCycleBatch.checksumSha256.slice(0, 12)}...
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeCycleBatch.status === "DRAFT" && canApprove && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openLockModal(activeCycleBatch.id)}
                      disabled={busyAction === `lock:${activeCycleBatch.id}`}
                    >
                      Lock Batch
                    </Button>
                  )}
                  {(activeCycleBatch.status === "LOCKED" ||
                    activeCycleBatch.status === "EXPORTED") &&
                    canExport && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleDownloadBatch(activeCycleBatch)}
                        disabled={busyAction === `download:${activeCycleBatch.id}`}
                      >
                        {activeCycleBatch.status === "LOCKED"
                          ? "Download & Mark Exported"
                          : "Re-download Export File"}
                      </Button>
                    )}
                  {activeCycleBatch.status === "DRAFT" && canEdit && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleDeleteDraft(activeCycleBatch)}
                    >
                      Delete Draft
                    </Button>
                  )}
                  {activeCycleBatch.status !== "VOIDED" && canApprove && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setVoidReason("");
                        setVoidModalBatch(activeCycleBatch);
                      }}
                    >
                      Void Batch
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Readiness Panel */}
          {preview && (
            <Card className="p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-security-navy-900">
                    Cycle Readiness Gate
                  </span>
                  <Badge
                    variant={
                      preview.readiness.status === "READY" && preview.blockers.length === 0
                        ? "success"
                        : "warning"
                    }
                  >
                    {preview.readiness.status === "READY" && preview.blockers.length === 0
                      ? "READY FOR SAGE EXPORT"
                      : "ITEMS REQUIRE ATTENTION"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                  <Link href="/attendance/exceptions" className="text-security-navy-700 hover:underline font-medium">
                    Exceptions: <strong>{preview.readiness.openExceptions}</strong>
                  </Link>
                  <Link href="/attendance" className="text-security-navy-700 hover:underline font-medium">
                    Unapproved Site Sheets: <strong>{preview.readiness.unapprovedSiteTimesheets}</strong>
                  </Link>
                  <Link href="/employees/leave" className="text-security-navy-700 hover:underline font-medium">
                    Pending Leave: <strong>{preview.readiness.pendingLeaveRequests}</strong>
                  </Link>
                  <Link href="/employees" className="text-security-navy-700 hover:underline font-medium">
                    Missing Sage Codes: <strong>{preview.missingCodeEmployees.length}</strong>
                  </Link>
                </div>
              </div>

              {preview.blockers.length > 0 && (
                <div className="rounded-security border border-security-amber-200 bg-security-amber-50/60 p-3 text-xs text-security-navy-800 space-y-1">
                  {preview.blockers.map((b, idx) => (
                    <div key={idx}>• {b}</div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Totals Strip */}
          {preview && (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
              {[
                { label: "Employees", val: String(preview.summary.employeeCount) },
                { label: "Export Lines", val: String(preview.summary.lineCount) },
                { label: "Basic Hrs", val: num(preview.summary.totalBasicHours) },
                { label: "Overtime Hrs", val: num(preview.summary.totalOvertimeHours) },
                { label: "Sunday Hrs", val: num(preview.summary.totalSundayHours) },
                { label: "Holiday Hrs", val: num(preview.summary.totalPublicHolidayHours) },
                { label: "Night Hrs", val: num(preview.summary.totalNightShiftHours) },
                { label: "Paid Leave Hrs", val: num(preview.summary.totalPaidLeaveHours) },
              ].map((stat) => (
                <Card key={stat.label} className="p-3 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-security-navy-500 font-semibold">
                    {stat.label}
                  </div>
                  <div className="text-lg font-bold font-mono text-security-navy-900 mt-0.5">
                    {stat.val}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Lines Table */}
          {loadingPreview ? (
            <Card className="p-8 text-center text-sm text-security-navy-500">
              Aggregating approved attendance &amp; leave for {selectedPeriodKey}...
            </Card>
          ) : !preview || preview.lines.length === 0 ? (
            <EmptyState
              title="No approved hours or leave in this cycle"
              description="Approve site timesheets, verified attendances, or leave requests for this 26th–25th cycle to generate export lines."
            />
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-security-navy-100 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-security-navy-900">
                  Live Normalized Preview ({preview.lines.length} lines)
                </h3>
                <button
                  type="button"
                  onClick={() => setShowRawPreview((v) => !v)}
                  className="text-xs font-semibold text-security-amber-700 hover:underline"
                >
                  {showRawPreview ? "Hide Raw Adapter Output" : `Inspect Raw ${preview.renderedPreview.filename}`}
                </button>
              </div>

              {showRawPreview && (
                <div className="p-4 bg-security-navy-950 text-security-navy-100 border-b border-security-navy-200">
                  <pre className="text-xs font-mono overflow-x-auto max-h-64 whitespace-pre">
                    {preview.renderedPreview.content || "(Empty output)"}
                  </pre>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-security-navy-100 text-xs">
                  <thead className="bg-security-navy-50 text-security-navy-600 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Employee</th>
                      <th className="px-3 py-2 text-left">Sage Code</th>
                      <th className="px-3 py-2 text-left">Site / Cost Ctr</th>
                      <th className="px-3 py-2 text-right">Basic</th>
                      <th className="px-3 py-2 text-right">OT</th>
                      <th className="px-3 py-2 text-right">Sun</th>
                      <th className="px-3 py-2 text-right">PH</th>
                      <th className="px-3 py-2 text-right">Night</th>
                      <th className="px-3 py-2 text-right">Annual</th>
                      <th className="px-3 py-2 text-right">Sick</th>
                      <th className="px-3 py-2 text-right">Other Paid</th>
                      <th className="px-3 py-2 text-right">Unpaid</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-security-navy-100 bg-white">
                    {preview.lines.map((line, i) => (
                      <tr key={`${line.employeeId}:${line.siteId ?? "all"}:${i}`} className="hover:bg-security-navy-50/40">
                        <td className="px-3 py-2 font-medium text-security-navy-900 whitespace-nowrap">
                          {line.employeeFullName}
                          <span className="block text-[10px] text-security-navy-400">
                            {line.employeeNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono whitespace-nowrap">
                          {line.externalPayrollCode}
                          {line.missingPayrollCode && (
                            <span className="ml-1 text-[10px] text-amber-700 font-sans">(fallback)</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-security-navy-700">
                          {line.siteName ?? "Consolidated"}
                          {line.costCenterCode && (
                            <span className="block font-mono text-[10px] text-security-navy-500">
                              {line.costCenterCode}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.basicHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.overtimeHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.sundayHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.publicHolidayHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.nightShiftHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.annualLeaveHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.sickLeaveHours)}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {num(Number(line.familyLeaveHours) + Number(line.studyLeaveHours))}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{num(line.unpaidLeaveHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 2: EXPORT HISTORY */}
      {!loadingInit && tab === "history" && (
        <div className="space-y-4">
          {batches.length === 0 ? (
            <EmptyState
              title="No export batches yet"
              description="Create a snapshot on the Export Cycle tab to build an immutable export batch."
            />
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-security-navy-100 text-sm">
                  <thead className="bg-security-navy-50 text-xs uppercase text-security-navy-600">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Period</th>
                      <th className="px-4 py-2.5 text-left">Profile</th>
                      <th className="px-4 py-2.5 text-left">Status</th>
                      <th className="px-4 py-2.5 text-right">Employees</th>
                      <th className="px-4 py-2.5 text-right">Total Worked Hrs</th>
                      <th className="px-4 py-2.5 text-left">Checksum</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-security-navy-100 bg-white">
                    {batches.map((b) => {
                      const totalWorked =
                        Number(b.totalBasicHours) +
                        Number(b.totalOvertimeHours) +
                        Number(b.totalSundayHours) +
                        Number(b.totalPublicHolidayHours);
                      return (
                        <tr key={b.id} className="hover:bg-security-navy-50/40">
                          <td className="px-4 py-3 font-medium text-security-navy-900">
                            {b.periodKey}
                            <span className="block text-xs text-security-navy-500">
                              {b.periodStart.slice(0, 10)} – {b.periodEnd.slice(0, 10)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-security-navy-700">
                            {b.profile.name}
                            <span className="block text-security-navy-400">
                              {PROVIDER_LABELS[b.profile.provider]}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={batchBadgeVariant(b.status)}>{b.status}</Badge>
                            {b.voidReason && (
                              <span className="block text-[11px] text-red-700 mt-0.5">
                                {b.voidReason}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{b.employeeCount}</td>
                          <td className="px-4 py-3 text-right font-mono">{totalWorked.toFixed(2)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-security-navy-500">
                            {b.checksumSha256 ? b.checksumSha256.slice(0, 12) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void handleInspectBatch(b.id)}
                              className="text-xs font-semibold text-security-navy-700 hover:underline"
                            >
                              Lines
                            </button>
                            {b.status === "DRAFT" && canApprove && (
                              <button
                                type="button"
                                onClick={() => openLockModal(b.id)}
                                className="text-xs font-semibold text-security-amber-700 hover:underline"
                              >
                                Lock
                              </button>
                            )}
                            {(b.status === "LOCKED" || b.status === "EXPORTED") && canExport && (
                              <button
                                type="button"
                                onClick={() => void handleDownloadBatch(b)}
                                className="text-xs font-semibold text-emerald-700 hover:underline"
                              >
                                {b.status === "LOCKED" ? "Download" : "Re-download"}
                              </button>
                            )}
                            {b.status === "DRAFT" && canEdit && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteDraft(b)}
                                className="text-xs font-semibold text-red-600 hover:underline"
                              >
                                Delete
                              </button>
                            )}
                            {b.status !== "VOIDED" && canApprove && (
                              <button
                                type="button"
                                onClick={() => {
                                  setVoidReason("");
                                  setVoidModalBatch(b);
                                }}
                                className="text-xs font-semibold text-red-600 hover:underline"
                              >
                                Void
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 3: PROFILES & SAGE MAPPING */}
      {!loadingInit && tab === "profiles" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-security-navy-600">
              Configure how Plethora maps attendance &amp; leave components into your external payroll software codes.
            </p>
            {canEdit && (
              <Button variant="primary" size="sm" onClick={startNewProfile}>
                New Export Profile
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profiles.map((p) => (
              <Card key={p.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-security-navy-900">{p.name}</h3>
                      {p.isDefault && <Badge variant="success">Default</Badge>}
                    </div>
                    <p className="text-xs text-security-navy-500 mt-0.5">
                      {PROVIDER_LABELS[p.provider]} · Delimiter: &quot;{p.delimiter === "\t" ? "TAB" : p.delimiter}&quot; · Date: {p.dateFormat}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEditProfile(p)}
                        className="text-xs font-semibold text-security-navy-700 hover:underline"
                      >
                        Edit
                      </button>
                      {profiles.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteProfile(p)}
                          className="text-xs font-semibold text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-security-navy-100 pt-2">
                  {CODE_FIELDS.map((cf) => (
                    <div key={cf.key} className="flex justify-between">
                      <span className="text-security-navy-500">{cf.label}:</span>
                      <span className="font-mono font-semibold text-security-navy-900">
                        {p.codeMappingJson?.[cf.key] ?? DEFAULT_CODES[cf.key]}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* LOCK MODAL */}
      {lockModalBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg p-6 space-y-4">
            <h3 className="text-base font-semibold text-security-navy-900">
              Lock Payroll Export Batch
            </h3>
            <p className="text-sm text-security-navy-600">
              Locking freezes approved site timesheets and marks approved leave requests in this period as exported. Only one active locked/exported batch is allowed per cycle.
            </p>
            {lockModalBatch.hasBlockers && (
              <div className="space-y-2">
                <AlertBanner variant="warning">
                  Some readiness warnings remain open: {lockModalBatch.blockers.join("; ")}
                </AlertBanner>
                <div>
                  <label className="block text-xs font-semibold uppercase text-security-navy-700 mb-1">
                    Override Reason (Required to proceed)
                  </label>
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    rows={3}
                    placeholder="Explain why locking with open items is authorised..."
                    className="input-modern w-full"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setLockModalBatch(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleConfirmLock()}
                disabled={busyAction?.startsWith("lock:")}
              >
                {busyAction?.startsWith("lock:") ? "Locking..." : "Confirm Lock"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* VOID MODAL */}
      {voidModalBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-lg p-6 space-y-4">
            <h3 className="text-base font-semibold text-security-navy-900">
              Void Export Batch ({voidModalBatch.periodKey})
            </h3>
            <p className="text-sm text-security-navy-600">
              Voiding releases linked leave requests so you can generate a replacement snapshot for this cycle.
            </p>
            <div>
              <label className="block text-xs font-semibold uppercase text-security-navy-700 mb-1">
                Mandatory Void Reason
              </label>
              <textarea
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                rows={3}
                placeholder="e.g. Late overtime amendment added for Sandton site"
                className="input-modern w-full"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setVoidModalBatch(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleConfirmVoid()}
                disabled={busyAction?.startsWith("void:")}
              >
                Confirm Void
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* BATCH DETAIL MODAL */}
      {selectedBatchDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-security-navy-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-security-navy-900">
                  Batch {selectedBatchDetail.periodKey} · {selectedBatchDetail.profile.name}
                </h3>
                <p className="text-xs text-security-navy-500 font-mono">
                  Checksum: {selectedBatchDetail.checksumSha256}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setSelectedBatchDetail(null)}>
                Close
              </Button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="min-w-full divide-y divide-security-navy-100 text-xs">
                <thead className="bg-security-navy-50 uppercase text-security-navy-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Sage Code</th>
                    <th className="px-3 py-2 text-left">Site / Cost Ctr</th>
                    <th className="px-3 py-2 text-right">Basic</th>
                    <th className="px-3 py-2 text-right">OT</th>
                    <th className="px-3 py-2 text-right">Sun</th>
                    <th className="px-3 py-2 text-right">PH</th>
                    <th className="px-3 py-2 text-right">Night</th>
                    <th className="px-3 py-2 text-right">Paid Leave</th>
                    <th className="px-3 py-2 text-right">Unpaid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100 bg-white">
                  {(selectedBatchDetail.lines ?? []).map((l, idx) => (
                    <tr key={l.id ?? idx}>
                      <td className="px-3 py-2 font-medium">{l.employeeFullName}</td>
                      <td className="px-3 py-2 font-mono">{l.externalPayrollCode}</td>
                      <td className="px-3 py-2">
                        {l.site?.name ?? "Consolidated"}
                        {l.costCenterCode ? ` (${l.costCenterCode})` : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{num(l.basicHours)}</td>
                      <td className="px-3 py-2 text-right font-mono">{num(l.overtimeHours)}</td>
                      <td className="px-3 py-2 text-right font-mono">{num(l.sundayHours)}</td>
                      <td className="px-3 py-2 text-right font-mono">{num(l.publicHolidayHours)}</td>
                      <td className="px-3 py-2 text-right font-mono">{num(l.nightShiftHours)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {num(
                          Number(l.annualLeaveHours) +
                            Number(l.sickLeaveHours) +
                            Number(l.familyLeaveHours) +
                            Number(l.studyLeaveHours)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{num(l.unpaidLeaveHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* PROFILE MODAL */}
      {showProfileForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-security-navy-900">
                  {editingProfile ? "Edit Export Profile" : "Create Export Profile"}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowProfileForm(false)}
                  className="text-sm text-security-navy-500"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-security-navy-700 mb-1">
                    Profile Name *
                  </label>
                  <input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="input-modern"
                    placeholder="e.g. Sage Business Cloud ZA"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-security-navy-700 mb-1">
                    Provider / Format
                  </label>
                  <select
                    value={profileForm.provider}
                    onChange={(e) =>
                      setProfileForm((f) => ({
                        ...f,
                        provider: e.target.value as PayrollExportProvider,
                      }))
                    }
                    className="input-modern"
                  >
                    {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-security-navy-700 mb-1">
                    CSV Delimiter
                  </label>
                  <select
                    value={profileForm.delimiter}
                    onChange={(e) => setProfileForm((f) => ({ ...f, delimiter: e.target.value }))}
                    className="input-modern"
                  >
                    <option value=",">Comma (,)</option>
                    <option value=";">Semicolon (;)</option>
                    <option value="|">Pipe (|)</option>
                    <option value={"\t"}>Tab</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-security-navy-700 mb-1">
                    Date Format
                  </label>
                  <select
                    value={profileForm.dateFormat}
                    onChange={(e) => setProfileForm((f) => ({ ...f, dateFormat: e.target.value }))}
                    className="input-modern"
                  >
                    <option value="yyyy-MM-dd">YYYY-MM-DD</option>
                    <option value="dd/MM/yyyy">DD/MM/YYYY</option>
                    <option value="dd-MM-yyyy">DD-MM-YYYY</option>
                    <option value="yyyyMMdd">YYYYMMDD</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap gap-6 text-sm">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profileForm.splitBySite}
                    onChange={(e) => setProfileForm((f) => ({ ...f, splitBySite: e.target.checked }))}
                  />
                  <span>Split hours by site cost centre by default</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profileForm.isDefault}
                    onChange={(e) => setProfileForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  />
                  <span>Set as company default profile</span>
                </label>
              </div>

              <div className="border-t border-security-navy-100 pt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-security-navy-600 mb-2">
                  Sage / External Transaction Code Mapping
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CODE_FIELDS.map((cf) => (
                    <div key={cf.key}>
                      <label className="block text-xs text-security-navy-600 mb-0.5">{cf.label}</label>
                      <input
                        value={profileForm.codeMappingJson[cf.key] ?? ""}
                        onChange={(e) =>
                          setProfileForm((f) => ({
                            ...f,
                            codeMappingJson: { ...f.codeMappingJson, [cf.key]: e.target.value },
                          }))
                        }
                        className="input-modern font-mono text-xs"
                        placeholder={DEFAULT_CODES[cf.key]}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  onClick={() => setShowProfileForm(false)}
                >
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit" disabled={busyAction === "save-profile"}>
                  {busyAction === "save-profile" ? "Saving..." : "Save Profile"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
