"use client";

import { useEffect, useState, useCallback } from "react";
import { authFetch } from "@/lib/api";
import { Badge } from "@/components/ui";

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
        `✅ Roll-call summary successfully dispatched to ${data.recipientCount} office WhatsApp number${
          data.recipientCount === 1 ? "" : "s"
        }!`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col rounded-security-xl border border-security-navy-100 bg-white shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-security-navy-100 bg-security-navy-50/70 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📋</span>
              <h2 className="text-lg font-bold text-security-navy-900">Shift Attendance Roll-Call</h2>
            </div>
            <p className="mt-0.5 text-xs text-security-navy-600">
              Aggregate verified guards on duty and dispatch parade state via WhatsApp
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-security-navy-400 hover:bg-security-navy-100 hover:text-security-navy-700 transition-colors"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Shift Type Filter Tabs */}
          <div className="flex items-center justify-between gap-3 border-b border-security-navy-100 pb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-security-navy-500">
              Select Shift
            </span>
            <div className="flex rounded-full bg-security-navy-100 p-0.5">
              {(["day", "night", "all"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setShiftType(t)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-all ${
                    shiftType === t
                      ? "bg-security-navy-800 text-white shadow-sm"
                      : "text-security-navy-600 hover:text-security-navy-900"
                  }`}
                >
                  {t === "all" ? "24h All" : `${t} Shift`}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-security-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              {error}
            </div>
          )}

          {dispatchSuccess && (
            <div className="rounded-security-lg border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900 animate-fade-in">
              {dispatchSuccess}
            </div>
          )}

          {loading ? (
            <div className="space-y-3 py-8 text-center">
              <div className="h-6 w-6 mx-auto animate-spin rounded-full border-2 border-security-navy-600 border-t-transparent" />
              <p className="text-xs text-security-navy-500">Aggregating guard verification state across sites...</p>
            </div>
          ) : summary ? (
            <>
              {/* Parade State High-Level Metrics */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-security border border-emerald-200 bg-emerald-50/60 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-800">Verified On Duty</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">
                    {summary.totalVerified}
                  </p>
                  <p className="text-[10px] text-emerald-700 font-medium">GPS Geofence Checked</p>
                </div>
                <div className="rounded-security border border-amber-200 bg-amber-50/60 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">Flagged / Warn</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-amber-900">
                    {summary.totalFlagged}
                  </p>
                  <p className="text-[10px] text-amber-700 font-medium">No GPS / Radius Alert</p>
                </div>
                <div className="rounded-security border border-red-200 bg-red-50/60 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-red-800">Absent / Unreported</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-red-900">
                    {summary.totalAbsent}
                  </p>
                  <p className="text-[10px] text-red-700 font-medium">No clock-in</p>
                </div>
                <div className="rounded-security border border-security-navy-200 bg-security-navy-50/80 p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-security-navy-700">Post Coverage</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-security-navy-900">
                    {summary.coveragePercentage}%
                  </p>
                  <p className="text-[10px] text-security-navy-600 font-medium">
                    {summary.totalVerified}/{summary.totalRostered} Posts
                  </p>
                </div>
              </div>

              {/* Site Breakdown List */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-security-navy-700">
                  Site-by-Site Parade State ({summary.sites.length} Active Sites)
                </h3>
                {summary.sites.length === 0 ? (
                  <p className="text-xs text-security-navy-500 py-3">No shifts scheduled in this window.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.sites.map((site) => (
                      <div
                        key={site.siteId}
                        className="rounded-security-lg border border-security-navy-100 bg-white p-3 shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-sm text-security-navy-900">{site.siteName}</span>
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
                            {site.verifiedCount}/{site.rosteredCount} Posts ({site.coveragePercentage}%)
                          </Badge>
                        </div>

                        {/* Guard details list */}
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {site.guards.map((g) => (
                            <span
                              key={g.shiftId}
                              className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs ${
                                g.status === "VERIFIED"
                                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  : g.status === "FLAGGED"
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : "bg-red-50 text-red-800 border border-red-200 font-medium"
                              }`}
                            >
                              <span>{g.status === "VERIFIED" ? "✓" : g.status === "FLAGGED" ? "⚠️" : "✗"}</span>
                              {g.name}
                              {g.clockInTime && <span className="opacity-75">({g.clockInTime})</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Designated Office Recipients Configuration */}
              <div className="rounded-security-lg border border-security-navy-100 bg-security-navy-50/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-security-navy-700">
                    Designated Office WhatsApp Numbers
                  </label>
                  <span className="text-[10px] text-security-navy-500">
                    Recipients who receive this summary
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recipients.map((phone) => (
                    <span
                      key={phone}
                      className="inline-flex items-center gap-1 rounded-full bg-white border border-security-navy-200 px-2.5 py-0.5 text-xs text-security-navy-800 shadow-xs"
                    >
                      <span>📱 +{phone}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveRecipient(phone)}
                        className="text-security-navy-400 hover:text-red-600 font-bold ml-1"
                        title="Remove number"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {recipients.length === 0 && (
                    <span className="text-xs text-amber-800 font-medium">
                      ⚠️ No office numbers configured. Add at least one number below.
                    </span>
                  )}
                </div>
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="Enter phone (e.g. 27821234567)"
                    className="input-compact text-xs flex-1"
                  />
                  <button
                    type="button"
                    onClick={handleAddRecipient}
                    className="btn-secondary text-xs px-3 py-1"
                  >
                    Add Number
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-security-navy-100 bg-security-navy-50/70 px-5 py-3">
          <button type="button" onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDispatch}
            disabled={dispatching || loading || recipients.length === 0}
            className="btn-primary flex items-center gap-2 text-xs py-1.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
          >
            <span>💬</span>
            {dispatching ? "Dispatching via WhatsApp..." : "Dispatch Summary via WhatsApp"}
          </button>
        </div>
      </div>
    </div>
  );
}
