"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { DateInput } from "@/components/date-input";

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

const statusColors: Record<string, string> = {
  draft: "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300",
  calculated: "bg-neutral-100 dark:bg-neutral-900/30 text-neutral-700 dark:text-neutral-400",
  approved: "bg-neutral-100 dark:bg-neutral-900/30 text-neutral-700 dark:text-neutral-400",
  paid: "bg-neutral-100 dark:bg-neutral-900/30 text-neutral-700 dark:text-neutral-400",
};

export default function PayrollPage() {
  const { token } = useAuth();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (!token) return;
    authFetch("/payroll/runs", token)
      .then((r) => r.json())
      .then((d) => setRuns(d.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  const refresh = () => {
    if (!token) return;
    authFetch("/payroll/runs", token)
      .then((r) => r.json())
      .then((d) => setRuns(d.data || []));
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-neutral-200 dark:bg-neutral-700 rounded w-48 mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-neutral-200 dark:bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 text-sm">Manage payroll runs and payments</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? "Cancel" : "New Payroll Run"}
          </button>
          <Link
            href="/payroll/configuration"
            className="p-2.5 rounded-lg border-2 border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-500 transition-all"
            aria-label="Payroll configuration"
          >
            <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>
      </div>

      {showForm && (
        <PayrollRunForm
          token={token!}
          onSuccess={() => {
            setShowForm(false);
            refresh();
          }}
        />
      )}

      <div className="card-wireframe mb-8 p-5">
        <h3 className="font-semibold text-neutral-900 dark:text-white mb-4">Pipeline</h3>
        <div className="flex gap-2 flex-wrap mb-2">
          <span className="badge-neutral">Attendance</span>
          <span className="text-neutral-400">→</span>
          <span className="badge-warning">Calculation</span>
          <span className="text-neutral-400">→</span>
          <span className="badge-neutral">Approval</span>
          <span className="text-neutral-400">→</span>
          <span className="badge-success">Paid</span>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Each payroll run progresses through these stages. Calculate first, then approve, then mark as paid.
        </p>
      </div>

      <div className="space-y-4">
        {runs.map((run) => (
          <PayrollRunCard
            key={run.id}
            run={run}
            token={token!}
            onAction={refresh}
          />
        ))}
      </div>

      {runs.length === 0 && (
        <p className="text-neutral-500 py-8 text-center">No payroll runs</p>
      )}
    </div>
  );
}

function PayrollRunForm({
  token,
  onSuccess,
}: {
  token: string;
  onSuccess: () => void;
}) {
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await authFetch("/payroll/runs", token, {
      method: "POST",
      body: JSON.stringify({
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      }),
    });
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="card-wireframe mb-8 p-6">
      <h3 className="font-semibold text-neutral-900 dark:text-white mb-4">New Payroll Run</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-600 dark:text-neutral-400 mb-1">Period start</label>
          <DateInput value={periodStart} onChange={setPeriodStart} className="input-modern" showToday required />
        </div>
        <div>
          <label className="block text-[10px] font-medium uppercase tracking-wider text-neutral-600 dark:text-neutral-400 mb-1">Period end</label>
          <DateInput value={periodEnd} onChange={setPeriodEnd} className="input-modern" showToday required />
        </div>
      </div>
      <button type="submit" className="mt-4 btn-primary">Create</button>
    </form>
  );
}

interface PayrollItem {
  id: string;
  employee: { firstName: string; lastName: string };
  netPay: string;
}

function PayrollRunCard({
  run,
  token,
  onAction,
}: {
  run: PayrollRun;
  token: string;
  onAction: () => void;
}) {
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [showItems, setShowItems] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloadingFnb, setDownloadingFnb] = useState(false);

  const fetchItems = () => {
    authFetch(`/payroll/runs/${run.id}/items`, token)
      .then((r) => r.json())
      .then((d) => setItems(d.data || []));
  };

  const handleCalculate = async () => {
    await authFetch(`/payroll/runs/${run.id}/calculate`, token, {
      method: "POST",
    });
    onAction();
  };

  const handleApprove = async () => {
    await authFetch(`/payroll/runs/${run.id}/approve`, token, {
      method: "POST",
    });
    onAction();
  };

  const handleMarkPaid = async () => {
    await authFetch(`/payroll/runs/${run.id}/mark-paid`, token, {
      method: "POST",
    });
    onAction();
  };

  const handlePreviewPayslip = async (item: PayrollItem) => {
    setPreviewingId(item.id);
    setPreviewError(null);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/items/${item.id}/payslip/pdf`, token);
      if (!res.ok) throw new Error("Failed to load payslip");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load payslip");
    } finally {
      setPreviewingId(null);
    }
  };

  const handleDownloadFnbCsv = async () => {
    setDownloadingFnb(true);
    try {
      const res = await authFetch(`/payroll/runs/${run.id}/export/fnb`, token);
      if (!res.ok) throw new Error("Failed to download FNB CSV");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-fnb-${format(new Date(run.periodStart), "yyyy-MM")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to download FNB CSV");
    } finally {
      setDownloadingFnb(false);
    }
  };

  const canExportFnb = ["calculated", "approved", "paid"].includes(run.status);

  return (
    <div className="card-wireframe p-4">
      <div className="flex justify-between items-center">
        <div>
          <span className="font-medium">
            {new Date(run.periodStart).toLocaleDateString()} -{" "}
            {new Date(run.periodEnd).toLocaleDateString()}
          </span>
          <span
            className={`ml-2 inline-block px-2 py-0.5 rounded text-xs ${
              statusColors[run.status] || "bg-neutral-100"
            }`}
          >
            {run.status}
          </span>
        </div>
        <div className="flex gap-2">
          {run.status === "draft" && (
            <button
              onClick={handleCalculate}
              className="btn-primary text-sm"
            >
              Calculate
            </button>
          )}
          {run.status === "calculated" && (
            <button
              onClick={handleApprove}
              className="btn-primary text-sm"
            >
              Approve
            </button>
          )}
          {run.status === "approved" && (
            <button
              onClick={handleMarkPaid}
              className="btn-primary text-sm"
            >
              Mark Paid
            </button>
          )}
          <button
            onClick={() => {
              setShowItems(!showItems);
              if (!showItems) fetchItems();
            }}
            className="btn-secondary text-sm"
          >
            {showItems ? "Hide" : "View"} Items
          </button>
          {canExportFnb && (
            <button
              onClick={handleDownloadFnbCsv}
              disabled={downloadingFnb}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              {downloadingFnb ? "Downloading…" : "Download FNB CSV"}
            </button>
          )}
        </div>
      </div>
        {showItems && (
        <div className="mt-4 border-t border-neutral-200 dark:border-neutral-700 pt-4">
          {previewError && (
            <p className="text-red-600 dark:text-red-400 text-sm mb-2">{previewError}</p>
          )}
          {canExportFnb && items.length > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={handleDownloadFnbCsv}
                disabled={downloadingFnb}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {downloadingFnb ? "Downloading…" : "Download FNB CSV for Bulk Payment"}
              </button>
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Upload to FNB Online Banking for bulk salary payments
              </span>
            </div>
          )}
          {items.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Team Member</th>
                  <th className="text-right">Net Pay</th>
                  <th className="text-right w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.employee.firstName} {item.employee.lastName}
                    </td>
                    <td className="text-right">{item.netPay}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => handlePreviewPayslip(item)}
                        disabled={previewingId === item.id}
                        className="btn-secondary text-xs py-1.5 px-2 disabled:opacity-50"
                      >
                        {previewingId === item.id ? "Opening…" : "Preview Payslip"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-neutral-500 text-sm">No items yet. Run Calculate.</p>
          )}
        </div>
      )}
    </div>
  );
}
