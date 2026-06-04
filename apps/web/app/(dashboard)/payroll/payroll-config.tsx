"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/api";
import { useConfirmDialog } from "@/components/ui";

export interface PayGrade {
  id: string;
  name: string;
  hourlyRate: string;
  sortOrder: number;
}

export interface PayRule {
  id: string;
  ruleType: string;
  multiplier: string;
}

export interface EarningsRule {
  id: string;
  name: string;
  type: string;
  amount: string | null;
  rate: string | null;
  appliesTo: string;
}

export interface DeductionRule {
  id: string;
  name: string;
  type: string;
  amount: string | null;
  rate: string | null;
  appliesTo: string;
  isOptional: boolean;
}

export interface EmployeeGroup {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export function PayrollConfig({ token }: { token: string }) {
  const [groups, setGroups] = useState<EmployeeGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [grades, setGrades] = useState<PayGrade[]>([]);
  const [payRules, setPayRules] = useState<PayRule[]>([]);
  const [earnings, setEarnings] = useState<EarningsRule[]>([]);
  const [deductions, setDeductions] = useState<DeductionRule[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(() => {
    authFetch("/employee-groups", token)
      .then((r) => r.json())
      .then((d) => setGroups(d.data || []))
      .catch(console.error);
  }, [token]);

  const load = useCallback(() => {
    const groupId = selectedGroupId;
    const payGradesUrl = groupId
      ? `/payroll/pay-grades?groupId=${encodeURIComponent(groupId)}`
      : "/payroll/pay-grades";
    const payRulesUrl = groupId
      ? `/payroll/groups/${groupId}/pay-rules`
      : "/payroll/pay-rules";
    const earningsUrl = groupId
      ? `/payroll/groups/${groupId}/earnings-rules`
      : "/payroll/earnings-rules";
    const deductionsUrl = groupId
      ? `/payroll/groups/${groupId}/deduction-rules`
      : "/payroll/deduction-rules";

    Promise.all([
      authFetch(payGradesUrl, token).then((r) => r.json()),
      authFetch(payRulesUrl, token).then((r) => r.json()),
      authFetch(earningsUrl, token).then((r) => r.json()),
      authFetch(deductionsUrl, token).then((r) => r.json()),
    ])
      .then(([g, r, e, d]) => {
        setGrades(g.data || []);
        setPayRules(r.data || []);
        setEarnings(e.data || []);
        setDeductions(d.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, selectedGroupId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    setLoading(true);
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

  const selectedGroup = selectedGroupId
    ? groups.find((g) => g.id === selectedGroupId)
    : null;

  return (
    <div className="card-wireframe mb-6 p-4">
      <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-4">Payroll Configuration</h2>
      <div className="mb-4">
        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Configure rules for</label>
        <select
          value={selectedGroupId ?? ""}
          onChange={(e) => setSelectedGroupId(e.target.value || null)}
          className="px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900 min-w-[200px]"
        >
          <option value="">Company default (ungrouped team members)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Group: {g.name}
            </option>
          ))}
        </select>
        {selectedGroup && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Rules for team members in &quot;{selectedGroup.name}&quot;
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PayGradesSection grades={grades} token={token} onRefresh={load} groupId={selectedGroupId} />
        <PayRulesSection
          payRules={payRules}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
        />
        <EarningsRulesSection
          earnings={earnings}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
        />
        <DeductionRulesSection
          deductions={deductions}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
        />
      </div>
    </div>
  );
}

function PayGradesSection({
  grades,
  token,
  onRefresh,
  groupId,
}: {
  grades: PayGrade[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
}) {
  const [name, setName] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), hourlyRate: parseFloat(hourlyRate) };
      if (groupId) body.groupId = groupId;
      const res = await authFetch("/payroll/pay-grades", token, {
        method: "POST",
        body: JSON.stringify(body),
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
    const confirmed = await confirm({
      title: "Delete pay grade?",
      message: "This removes the pay grade if it is not currently in use.",
      confirmLabel: "Delete pay grade",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`/payroll/pay-grades/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete. It may be in use.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      {confirmDialog}
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
  groupId,
}: {
  payRules: PayRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
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
      const url = groupId
        ? `/payroll/groups/${groupId}/pay-rules`
        : "/payroll/pay-rules";
      await authFetch(url, token, {
        method: "PUT",
        body: JSON.stringify({ ruleType, multiplier }),
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const ruleTypesToShow = groupId
    ? (["overtime", "sunday", "public_holiday"] as const).filter((rt) =>
        payRules.some((r) => r.ruleType === rt)
      )
    : (["overtime", "sunday", "public_holiday"] as const);

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-2">Pay Rules</h3>
      <div className="space-y-2">
        {ruleTypesToShow.map((rt) => {
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
                <span className="text-neutral-400 text-xs cursor-default select-none" title="multiplier (edit value to change)">×</span>
              </div>
            </div>
          );
        })}
        {groupId && ruleTypesToShow.length === 0 && (
          <p className="text-neutral-500 dark:text-neutral-400 text-xs py-1">
            No pay rules configured for this group.
          </p>
        )}
        {groupId && ruleTypesToShow.length < 3 && (
          <AddPayRuleRow
            existingTypes={ruleTypesToShow}
            onRefresh={onRefresh}
            token={token}
            groupId={groupId}
          />
        )}
      </div>
    </div>
  );
}

function AddPayRuleRow({
  existingTypes,
  onRefresh,
  token,
  groupId,
}: {
  existingTypes: readonly string[];
  onRefresh: () => void;
  token: string;
  groupId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [ruleType, setRuleType] = useState<string>("");
  const [multiplier, setMultiplier] = useState("1.5");

  const ruleLabels: Record<string, string> = {
    overtime: "Overtime",
    sunday: "Sunday",
    public_holiday: "Public holiday",
  };
  const defaultMult: Record<string, number> = {
    overtime: 1.5,
    sunday: 2.0,
    public_holiday: 2.0,
  };
  const available = (["overtime", "sunday", "public_holiday"] as const).filter(
    (rt) => !existingTypes.includes(rt)
  );

  const handleAdd = async () => {
    if (!ruleType || available.length === 0) return;
    try {
      await authFetch(`/payroll/groups/${groupId}/pay-rules`, token, {
        method: "PUT",
        body: JSON.stringify({ ruleType, multiplier: parseFloat(multiplier) }),
      });
      setAdding(false);
      setRuleType("");
      setMultiplier("1.5");
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  if (available.length === 0) return null;

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
      >
        + Add {ruleLabels[available[0]]} rule
      </button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-neutral-200 dark:border-neutral-700">
      <select
        value={ruleType}
        onChange={(e) => {
          setRuleType(e.target.value);
          setMultiplier(String(defaultMult[e.target.value as keyof typeof defaultMult] ?? 1.5));
        }}
        className="px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
      >
        <option value="">Select rule type</option>
        {available.map((rt) => (
          <option key={rt} value={rt}>
            {ruleLabels[rt]}
          </option>
        ))}
      </select>
      <input
        type="number"
        step="0.1"
        min="0"
        max="10"
        value={multiplier}
        onChange={(e) => setMultiplier(e.target.value)}
        placeholder="×"
        className="w-14 px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-900"
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!ruleType}
        className="btn-secondary text-xs py-1 px-2"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setAdding(false)}
        className="text-xs text-neutral-500 hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}

function EarningsRulesSection({
  earnings,
  token,
  onRefresh,
  groupId,
}: {
  earnings: EarningsRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const baseUrl = groupId
    ? `/payroll/groups/${groupId}/earnings-rules`
    : "/payroll/earnings-rules";

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
      const res = await authFetch(baseUrl, token, {
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
    const confirmed = await confirm({
      title: "Delete earnings rule?",
      message: "This removes the earnings rule if it is not currently in use.",
      confirmLabel: "Delete rule",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`${baseUrl}/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete. It may be in use.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      {confirmDialog}
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
  groupId,
}: {
  deductions: DeductionRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const baseUrl = groupId
    ? `/payroll/groups/${groupId}/deduction-rules`
    : "/payroll/deduction-rules";

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
      const res = await authFetch(baseUrl, token, {
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
    const confirmed = await confirm({
      title: "Delete deduction rule?",
      message: "This removes the deduction rule if it is not currently in use.",
      confirmLabel: "Delete rule",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`${baseUrl}/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete. It may be in use.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className="p-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-800/30">
      {confirmDialog}
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
            <span className="flex items-center gap-2 text-neutral-500 dark:text-neutral-400">
              {d.type === "fixed" ? `R${Number(d.amount || 0).toFixed(2)}` : `${Number(d.rate || 0)}%`}
              <button type="button" onClick={() => handleDelete(d.id)} className="text-red-500 hover:text-red-600 text-xs" title="Delete">×</button>
            </span>
          </div>
        ))}
        {deductions.length === 0 && <p className="text-neutral-400 text-xs py-1">None</p>}
      </div>
    </div>
  );
}
