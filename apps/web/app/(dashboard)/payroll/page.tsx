"use client";

import { useEffect, useState, useCallback } from "react";
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

interface PayGrade {
  id: string;
  name: string;
  hourlyRate: string;
  sortOrder: number;
}

interface PayRule {
  id: string;
  ruleType: string;
  multiplier: string;
}

interface EarningsRule {
  id: string;
  name: string;
  type: string;
  amount: string | null;
  rate: string | null;
  appliesTo: string;
}

interface DeductionRule {
  id: string;
  name: string;
  type: string;
  amount: string | null;
  rate: string | null;
  appliesTo: string;
  isOptional: boolean;
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
  const [showConfig, setShowConfig] = useState(false);

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
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="btn-secondary"
          >
            {showConfig ? "Hide" : "Configuration"}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? "Cancel" : "New Payroll Run"}
          </button>
        </div>
      </div>

      {showConfig && (
        <PayrollConfig token={token!} />
      )}

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

function PayrollConfig({ token }: { token: string }) {
  const [grades, setGrades] = useState<PayGrade[]>([]);
  const [payRules, setPayRules] = useState<PayRule[]>([]);
  const [earnings, setEarnings] = useState<EarningsRule[]>([]);
  const [deductions, setDeductions] = useState<DeductionRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      authFetch("/payroll/pay-grades", token).then((r) => r.json()),
      authFetch("/payroll/pay-rules", token).then((r) => r.json()),
      authFetch("/payroll/earnings-rules", token).then((r) => r.json()),
      authFetch("/payroll/deduction-rules", token).then((r) => r.json()),
    ])
      .then(([g, r, e, d]) => {
        setGrades(g.data || []);
        setPayRules(r.data || []);
        setEarnings(e.data || []);
        setDeductions(d.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card-wireframe mb-6 p-4 animate-pulse">
        <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-32 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-neutral-200 dark:bg-neutral-700 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card-wireframe mb-6 p-4">
      <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-4">Payroll Configuration</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PayGradesSection grades={grades} token={token} onRefresh={load} />
        <PayRulesSection payRules={payRules} token={token} onRefresh={load} />
        <EarningsRulesSection earnings={earnings} token={token} onRefresh={load} />
        <DeductionRulesSection deductions={deductions} token={token} onRefresh={load} />
      </div>
    </div>
  );
}

function PayGradesSection({
  grades,
  token,
  onRefresh,
}: {
  grades: PayGrade[];
  token: string;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await authFetch("/payroll/pay-grades", token, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), hourlyRate: parseFloat(hourlyRate) }),
      });
      if (res.ok) {
        setName("");
        setHourlyRate("");
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this pay grade?")) return;
    try {
      await authFetch(`/payroll/pay-grades/${id}`, token, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Pay Grades</h3>
      <form onSubmit={handleAdd} className="flex gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
          required
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          placeholder="R/hr"
          className="w-20 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
          required
        />
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">
          {saving ? "…" : "Add"}
        </button>
      </form>
      <div className="space-y-1">
        {grades.map((g) => (
          <div key={g.id} className="flex items-center justify-between py-1.5 px-2 text-sm rounded hover:bg-neutral-100/80 dark:hover:bg-neutral-700/50">
            <span>{g.name}</span>
            <span className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
              R{Number(g.hourlyRate).toFixed(2)}/hr
              <button type="button" onClick={() => handleDelete(g.id)} className="text-red-500 hover:text-red-600 text-xs">×</button>
            </span>
          </div>
        ))}
        {grades.length === 0 && <p className="text-neutral-400 text-xs py-1">None</p>}
      </div>
    </div>
  );
}

function PayRulesSection({
  payRules,
  token,
  onRefresh,
}: {
  payRules: PayRule[];
  token: string;
  onRefresh: () => void;
}) {
  const ruleLabels: Record<string, string> = {
    overtime: "Overtime multiplier",
    sunday: "Sunday multiplier",
    public_holiday: "Public holiday multiplier",
  };
  const defaultMult: Record<string, number> = {
    overtime: 1.5,
    sunday: 2.0,
    public_holiday: 2.0,
  };

  const handleSave = async (ruleType: string, multiplier: number) => {
    try {
      await authFetch("/payroll/pay-rules", token, {
        method: "PUT",
        body: JSON.stringify({ ruleType, multiplier }),
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Pay Rules</h3>
      <div className="space-y-2">
        {(["overtime", "sunday", "public_holiday"] as const).map((rt) => {
          const rule = payRules.find((r) => r.ruleType === rt);
          const mult = rule ? Number(rule.multiplier) : defaultMult[rt];
          return (
            <div key={rt} className="flex items-center justify-between text-sm">
              <span className="text-neutral-600 dark:text-neutral-400">{ruleLabels[rt]}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  defaultValue={mult}
                  className="w-14 px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0 && v <= 10) handleSave(rt, v);
                  }}
                />
                <span className="text-neutral-400 text-xs">×</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EarningsRulesSection({
  earnings,
  token,
  onRefresh,
}: {
  earnings: EarningsRule[];
  token: string;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        appliesTo,
      };
      if (type === "fixed") body.amount = parseFloat(amount);
      else body.rate = parseFloat(rate);
      const res = await authFetch("/payroll/earnings-rules", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setName("");
        setAmount("");
        setRate("");
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this earnings rule?")) return;
    try {
      await authFetch(`/payroll/earnings-rules/${id}`, token, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Earnings</h3>
      <form onSubmit={handleAdd} className="flex gap-2 mb-3 flex-wrap">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="flex-1 min-w-[80px] px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as "fixed" | "percentage")} className="px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900 w-20">
          <option value="fixed">R</option>
          <option value="percentage">%</option>
        </select>
        {type === "fixed" ? (
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="w-16 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900" required />
        ) : (
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="w-14 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900" required />
        )}
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900 w-20">
          <option value="all">All</option>
          <option value="security">Sec</option>
          <option value="office">Off</option>
        </select>
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">{saving ? "…" : "Add"}</button>
      </form>
      <div className="space-y-1">
        {earnings.map((e) => (
          <div key={e.id} className="flex items-center justify-between py-1.5 px-2 text-sm rounded hover:bg-neutral-100/80 dark:hover:bg-neutral-700/50">
            <span>{e.name}</span>
            <span className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
              {e.type === "fixed" ? `R${Number(e.amount || 0).toFixed(2)}` : `${Number(e.rate || 0)}%`}
              <button type="button" onClick={() => handleDelete(e.id)} className="text-red-500 hover:text-red-600 text-xs">×</button>
            </span>
          </div>
        ))}
        {earnings.length === 0 && <p className="text-neutral-400 text-xs py-1">None</p>}
      </div>
    </div>
  );
}

function DeductionRulesSection({
  deductions,
  token,
  onRefresh,
}: {
  deductions: DeductionRule[];
  token: string;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [saving, setSaving] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        appliesTo,
      };
      if (type === "fixed") body.amount = parseFloat(amount);
      else body.rate = parseFloat(rate);
      const res = await authFetch("/payroll/deduction-rules", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setName("");
        setAmount("");
        setRate("");
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Deductions</h3>
      <form onSubmit={handleAdd} className="flex gap-2 mb-3 flex-wrap">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="flex-1 min-w-[80px] px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as "fixed" | "percentage")} className="px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900 w-20">
          <option value="fixed">R</option>
          <option value="percentage">%</option>
        </select>
        {type === "fixed" ? (
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="w-16 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900" required />
        ) : (
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="w-14 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900" required />
        )}
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900 w-20">
          <option value="all">All</option>
          <option value="security">Sec</option>
          <option value="office">Off</option>
        </select>
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">{saving ? "…" : "Add"}</button>
      </form>
      <div className="space-y-1">
        {deductions.map((d) => (
          <div key={d.id} className="flex items-center justify-between py-1.5 px-2 text-sm rounded hover:bg-neutral-100/80 dark:hover:bg-neutral-700/50">
            <span>{d.name}</span>
            <span className="text-neutral-500 dark:text-neutral-400">
              {d.type === "fixed" ? `R${Number(d.amount || 0).toFixed(2)}` : `${Number(d.rate || 0)}%`}
            </span>
          </div>
        ))}
        {deductions.length === 0 && <p className="text-neutral-400 text-xs py-1">None</p>}
      </div>
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
        </div>
      </div>
        {showItems && (
        <div className="mt-4 border-t border-neutral-200 dark:border-neutral-700 pt-4">
          {previewError && (
            <p className="text-red-600 dark:text-red-400 text-sm mb-2">{previewError}</p>
          )}
          {items.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Employee</th>
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
