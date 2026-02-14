"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";

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
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight">Payroll</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 text-sm">Manage payroll runs and payments</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? "Cancel" : "New Payroll Run"}
        </button>
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

      <div className="mb-8 p-5 bg-neutral-50 dark:bg-neutral-950/30 rounded-sm border border-black dark:border-white">
        <h3 className="font-semibold text-neutral-900 dark:text-white mb-4">Pipeline</h3>
        <div className="flex gap-2 flex-wrap mb-2">
          <span className="px-3 py-1 rounded-sm bg-white dark:bg-neutral-800 border border-black dark:border-white text-sm font-medium">Attendance</span>
          <span className="text-neutral-400">→</span>
          <span className="px-3 py-1 rounded-sm bg-white dark:bg-neutral-800 border border-black dark:border-white text-sm font-medium">Calculation</span>
          <span className="text-neutral-400">→</span>
          <span className="px-3 py-1 rounded-sm bg-white dark:bg-neutral-800 border border-black dark:border-white text-sm font-medium">Approval</span>
          <span className="text-neutral-400">→</span>
          <span className="px-3 py-1 rounded-sm bg-white dark:bg-neutral-800 border border-black dark:border-white text-sm font-medium">Paid</span>
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
    <form onSubmit={handleSubmit} className="mb-8 p-6 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white ">
      <h3 className="font-semibold text-neutral-900 dark:text-white mb-4">New Payroll Run</h3>
      <div className="grid grid-cols-2 gap-4">
        <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required className="input-modern" />
        <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required className="input-modern" />
      </div>
      <button type="submit" className="mt-4 btn-primary">Create</button>
    </form>
  );
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
  const [items, setItems] = useState<{ employee: { firstName: string; lastName: string }; netPay: string }[]>([]);
  const [showItems, setShowItems] = useState(false);

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

  return (
    <div className="p-4 bg-white dark:bg-neutral-900 rounded-sm border border-black dark:border-white ">
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
        </div>
      </div>
      {showItems && (
        <div className="mt-4 border-t border-black dark:border-white pt-4">
          {items.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Employee</th>
                  <th className="text-right">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>
                      {item.employee.firstName} {item.employee.lastName}
                    </td>
                    <td className="text-right">{item.netPay}</td>
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
