"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/api";
import { AlertBanner, Badge, Button, Card, Input, KpiStrip, Modal, Spinner, Tabs } from "@/components/ui";

interface GuardItem {
  shiftId: string;
  employeeId: string;
  name: string;
  phone: string | null;
  status: "VERIFIED" | "FLAGGED" | "REJECTED" | "ABSENT";
  clockInTime: string | null;
  clockOutTime: string | null;
  distanceMeters: number | null;
}

interface SiteSummary {
  siteId: string;
  siteName: string;
  supervisorName: string | null;
  rosteredCount: number;
  verifiedCount: number;
  flaggedCount: number;
  absentCount: number;
  coveragePercentage: number;
  guards: GuardItem[];
}

interface RollCallSummary {
  companyName: string;
  shiftType: "day" | "night" | "all";
  shiftLabel: string;
  dateStr: string;
  generatedAt: string;
  totalSites: number;
  totalRostered: number;
  totalVerified: number;
  totalFlagged: number;
  totalAbsent: number;
  coveragePercentage: number;
  sites: SiteSummary[];
}

interface ShiftRollCallModalProps {
  token: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShiftRollCallModal({ token, isOpen, onClose }: ShiftRollCallModalProps) {
  const [shiftType, setShiftType] = useState<"day" | "night" | "all">(() =>
    new Date().getHours() >= 18 || new Date().getHours() < 6 ? "night" : "day"
  );
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<RollCallSummary | null>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (!token || !isOpen) return;
    setLoading(true);
    setError(null);
    setDispatchSuccess(null);
    try {
      const res = await authFetch(`/attendance/roll-call/preview?shiftType=${shiftType}`, token);
      if (!res.ok) {
        throw new Error("Unable to load roll-call parade state");
      }
      const data = await res.json();
      setSummary(data.summary);
      setRecipients(data.recipients || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roll-call");
    } finally {
      setLoading(false);
    }
  }, [token, isOpen, shiftType]);

  useEffect(() => {
    if (isOpen) {
      loadPreview();
    }
  }, [isOpen, loadPreview]);

  const handleAddRecipient = async () => {
    const clean = newPhone.trim();
    if (!clean) return;
    const updated = Array.from(new Set([...recipients, clean]));
    setRecipients(updated);
    setNewPhone("");
    try {
      await authFetch("/attendance/roll-call/recipients", token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designatedOfficePhones: updated }),
      });
    } catch {
      // ignore
    }
  };

  const handleRemoveRecipient = async (phoneToRemove: string) => {
    const updated = recipients.filter((p) => p !== phoneToRemove);
    setRecipients(updated);
    try {
      await authFetch("/attendance/roll-call/recipients", token, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ designatedOfficePhones: updated }),
      });
    } catch {
      // ignore
    }
  };

  const handleDispatch = async () => {
    if (!token) return;
    setDispatching(true);
    setError(null);
    setDispatchSuccess(null);
    try {
      const res = await authFetch("/attendance/roll-call/dispatch", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftType }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || "Failed to dispatch roll-call summary");
      }
      setDispatchSuccess(
        `Roll-call summary dispatched to ${data.recipientCount} office WhatsApp number${
          data.recipientCount === 1 ? "" : "s"
        }.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Shift Attendance Roll-Call"
      description="Aggregate verified guards on duty and dispatch parade state via WhatsApp."
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="signal"
            size="sm"
            loading={dispatching}
            disabled={loading || recipients.length === 0}
            onClick={handleDispatch}
          >
            Dispatch summary via WhatsApp
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-security-navy-100 pb-3">
          <span className="text-xs font-semibold text-security-navy-600">Select shift</span>
          <Tabs
            ariaLabel="Roll-call shift selection"
            variant="segmented"
            value={shiftType}
            onChange={setShiftType}
            items={[
              { value: "day", label: "Day shift" },
              { value: "night", label: "Night shift" },
              { value: "all", label: "24h all" },
            ]}
          />
        </div>

        {error && <AlertBanner variant="error">{error}</AlertBanner>}
        {dispatchSuccess && <AlertBanner variant="success">{dispatchSuccess}</AlertBanner>}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-xs text-security-navy-500">
            <Spinner />
            <span>Aggregating guard verification state across sites...</span>
          </div>
        ) : summary ? (
          <>
            <KpiStrip
              ariaLabel="Parade state metrics"
              items={[
                {
                  label: "Verified on duty",
                  value: summary.totalVerified,
                  sublabel: "GPS geofence checked",
                  tone: "success",
                },
                {
                  label: "Flagged / warn",
                  value: summary.totalFlagged,
                  sublabel: "No GPS / radius alert",
                  tone: summary.totalFlagged > 0 ? "warning" : "default",
                },
                {
                  label: "Absent / unreported",
                  value: summary.totalAbsent,
                  sublabel: "No clock-in",
                  tone: summary.totalAbsent > 0 ? "danger" : "default",
                },
                {
                  label: "Post coverage",
                  value: `${summary.coveragePercentage}%`,
                  sublabel: `${summary.totalVerified}/${summary.totalRostered} posts`,
                },
              ]}
            />

            <div className="space-y-2.5">
              <h2 className="text-xs font-semibold text-security-navy-700">
                Site-by-site parade state ({summary.sites.length} active sites)
              </h2>
              {summary.sites.length === 0 ? (
                <p className="py-3 text-xs text-security-navy-500">No shifts scheduled in this window.</p>
              ) : (
                <div className="space-y-2">
                  {summary.sites.map((site) => (
                    <Card key={site.siteId} variant="wireframe" className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold text-security-navy-900">{site.siteName}</span>
                          {site.supervisorName && (
                            <span className="ml-2 text-xs text-security-navy-500">
                              (Supervisor: {site.supervisorName})
                            </span>
                          )}
                        </div>
                        <Badge
                          variant={
                            site.coveragePercentage === 100
                              ? "success"
                              : site.absentCount > 0
                                ? "error"
                                : "warning"
                          }
                        >
                          {site.verifiedCount}/{site.rosteredCount} posts ({site.coveragePercentage}%)
                        </Badge>
                      </div>

                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {site.guards.map((g) => (
                          <span
                            key={g.shiftId}
                            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                              g.status === "VERIFIED"
                                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                                : g.status === "FLAGGED"
                                  ? "border border-amber-200 bg-amber-50 text-amber-800"
                                  : "border border-red-200 bg-red-50 font-medium text-red-800"
                            }`}
                          >
                            <span>{g.status === "VERIFIED" ? "✓" : g.status === "FLAGGED" ? "!" : "✕"}</span>
                            {g.name}
                            {g.clockInTime && <span className="opacity-75">({g.clockInTime})</span>}
                          </span>
                        ))}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-security-lg border border-security-navy-100 bg-security-navy-50/50 p-3">
              <div className="flex items-center justify-between">
                <span className="label-text">Designated office WhatsApp numbers</span>
                <span className="text-xs text-security-navy-500">Recipients who receive this summary</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((phone) => (
                  <span
                    key={phone}
                    className="inline-flex items-center gap-1 rounded-full border border-security-navy-200 bg-white px-2.5 py-0.5 text-xs text-security-navy-800"
                  >
                    <span>+{phone}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRecipient(phone)}
                      className="ml-1 font-bold text-security-navy-400 hover:text-red-600"
                      title="Remove number"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {recipients.length === 0 && (
                  <span className="text-xs font-medium text-security-amber-800">
                    No office numbers configured. Add at least one number below.
                  </span>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Input
                  density="compact"
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Enter phone (e.g. 27821234567)"
                  className="flex-1"
                />
                <Button variant="secondary" size="sm" onClick={handleAddRecipient}>
                  Add number
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
