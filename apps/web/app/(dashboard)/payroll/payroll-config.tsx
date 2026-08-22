"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/api";
import { useConfirmDialog } from "@/components/ui";

const CONFIG_SECTION_CLASS = "rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card";

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

export function PayrollConfig({
  token,
  canCreate,
  canEdit,
  canDelete,
}: {
  token: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
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
      <div className="card-wireframe p-4 animate-pulse">
        <div className="h-4 bg-security-navy-100 rounded w-32 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-security-navy-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const selectedGroup = selectedGroupId
    ? groups.find((g) => g.id === selectedGroupId)
    : null;

  return (
    <div className="card-wireframe p-5 space-y-5">
      <div>
        <h2 className="section-title mb-3">Rule scope</h2>
        <label htmlFor="payroll-config-group" className="label-text block mb-1.5">
          Configure rules for
        </label>
        <select
          id="payroll-config-group"
          value={selectedGroupId ?? ""}
          onChange={(e) => setSelectedGroupId(e.target.value || null)}
          className="input-modern min-w-[16rem] text-sm"
        >
          <option value="">Company default (ungrouped team members)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Group: {g.name}
            </option>
          ))}
        </select>
        {selectedGroup && (
          <p className="text-xs text-security-navy-600 mt-1">
            Rules for team members in &quot;{selectedGroup.name}&quot;
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PayGradesSection
          grades={grades}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
          canCreate={canCreate}
          canDelete={canDelete}
        />
        <PayRulesSection
          payRules={payRules}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
          canEdit={canEdit}
        />
        <EarningsRulesSection
          earnings={earnings}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
          canCreate={canCreate}
          canDelete={canDelete}
        />
        <DeductionRulesSection
          deductions={deductions}
          token={token}
          onRefresh={load}
          groupId={selectedGroupId}
          canCreate={canCreate}
          canDelete={canDelete}
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
  canCreate,
  canDelete,
}: {
  grades: PayGrade[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
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
    if (!canDelete) return;
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
    <div className={CONFIG_SECTION_CLASS}>
      {confirmDialog}
      <h3 className="label-text mb-3">Pay grades</h3>
      {canCreate && <form onSubmit={handleAdd} className="flex gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-compact flex-1 min-w-0"
          required
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          placeholder="R/hr"
          className="input-compact w-20"
          required
        />
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">
          {saving ? "…" : "Add"}
        </button>
      </form>}
      <div className="space-y-1">
        {grades.map((g) => (
          <div key={g.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-security-navy-50">
            <span className="text-security-navy-900">{g.name}</span>
            <span className="flex items-center gap-2 font-mono text-security-navy-600">
              R{Number(g.hourlyRate).toFixed(2)}/hr
              {canDelete && <button type="button" onClick={() => handleDelete(g.id)} className="text-red-600 hover:text-red-700 text-xs" aria-label={`Delete ${g.name}`}>×</button>}
            </span>
          </div>
        ))}
        {grades.length === 0 && <p className="text-security-navy-500 text-xs py-1">No pay grades yet</p>}
      </div>
    </div>
  );
}

function PayRulesSection({
  payRules,
  token,
  onRefresh,
  groupId,
  canEdit,
}: {
  payRules: PayRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canEdit: boolean;
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
    if (!canEdit) return;
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
    <div className={CONFIG_SECTION_CLASS}>
      <h3 className="label-text mb-3">Pay rules</h3>
      <div className="space-y-2">
        {ruleTypesToShow.map((rt) => {
          const rule = payRules.find((r) => r.ruleType === rt);
          const mult = rule ? Number(rule.multiplier) : defaultMult[rt];
          return (
            <div key={rt} className="flex items-center justify-between text-sm">
              <span className="text-security-navy-600">{ruleLabels[rt]}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  defaultValue={mult}
                  disabled={!canEdit}
                  className="input-compact w-16"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0 && v <= 10) handleSave(rt, v);
                  }}
                />
                <span className="text-security-navy-400 text-xs cursor-default select-none" title="multiplier (edit value to change)">×</span>
              </div>
            </div>
          );
        })}
        {groupId && ruleTypesToShow.length === 0 && (
          <p className="text-security-navy-500 text-xs py-1">
            No pay rules configured for this group.
          </p>
        )}
        {canEdit && groupId && ruleTypesToShow.length < 3 && (
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
        className="text-xs font-medium text-security-amber-700 hover:underline"
      >
        + Add {ruleLabels[available[0]]} rule
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-security-navy-100 pt-2">
      <select
        value={ruleType}
        onChange={(e) => {
          setRuleType(e.target.value);
          setMultiplier(String(defaultMult[e.target.value as keyof typeof defaultMult] ?? 1.5));
        }}
        className="input-compact"
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
        className="input-compact w-16"
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
        className="text-xs text-security-navy-500 hover:underline"
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
  canCreate,
  canDelete,
}: {
  earnings: EarningsRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canCreate: boolean;
  canDelete: boolean;
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
    if (!canCreate) return;
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
    if (!canDelete) return;
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
    <div className={CONFIG_SECTION_CLASS}>
      {confirmDialog}
      <h3 className="label-text mb-3">Earnings</h3>
      {canCreate && <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-compact min-w-[80px] flex-1"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as "fixed" | "percentage")} className="input-compact w-20">
          <option value="fixed">R</option>
          <option value="percentage">%</option>
        </select>
        {type === "fixed" ? (
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="input-compact w-16" required />
        ) : (
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="input-compact w-16" required />
        )}
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="input-compact w-20">
          <option value="all">All</option>
          <option value="security">Sec</option>
          <option value="office">Off</option>
        </select>
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">{saving ? "…" : "Add"}</button>
      </form>}
      <div className="space-y-1">
        {earnings.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-security-navy-50">
            <span className="text-security-navy-900">{e.name}</span>
            <span className="flex items-center gap-2 font-mono text-security-navy-600">
              {e.type === "fixed" ? `R${Number(e.amount || 0).toFixed(2)}` : `${Number(e.rate || 0)}%`}
              {canDelete && <button type="button" onClick={() => handleDelete(e.id)} className="text-red-600 hover:text-red-700 text-xs" aria-label={`Delete ${e.name}`}>×</button>}
            </span>
          </div>
        ))}
        {earnings.length === 0 && <p className="text-security-navy-500 text-xs py-1">No earnings rules yet</p>}
      </div>
    </div>
  );
}

function DeductionRulesSection({
  deductions,
  token,
  onRefresh,
  groupId,
  canCreate,
  canDelete,
}: {
  deductions: DeductionRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canCreate: boolean;
  canDelete: boolean;
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
    if (!canCreate) return;
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
    if (!canDelete) return;
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
    <div className={CONFIG_SECTION_CLASS}>
      {confirmDialog}
      <h3 className="label-text mb-3">Deductions</h3>
      {canCreate && <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-compact min-w-[80px] flex-1"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as "fixed" | "percentage")} className="input-compact w-20">
          <option value="fixed">R</option>
          <option value="percentage">%</option>
        </select>
        {type === "fixed" ? (
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="input-compact w-16" required />
        ) : (
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="input-compact w-16" required />
        )}
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="input-compact w-20">
          <option value="all">All</option>
          <option value="security">Sec</option>
          <option value="office">Off</option>
        </select>
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">{saving ? "…" : "Add"}</button>
      </form>}
      <div className="space-y-1">
        {deductions.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-security-navy-50">
            <span className="text-security-navy-900">{d.name}</span>
            <span className="flex items-center gap-2 font-mono text-security-navy-600">
              {d.type === "fixed" ? `R${Number(d.amount || 0).toFixed(2)}` : `${Number(d.rate || 0)}%`}
              {canDelete && <button type="button" onClick={() => handleDelete(d.id)} className="text-red-600 hover:text-red-700 text-xs" title="Delete" aria-label={`Delete ${d.name}`}>×</button>}
            </span>
          </div>
        ))}
        {deductions.length === 0 && <p className="text-security-navy-500 text-xs py-1">No deduction rules yet</p>}
      </div>
    </div>
  );
}
