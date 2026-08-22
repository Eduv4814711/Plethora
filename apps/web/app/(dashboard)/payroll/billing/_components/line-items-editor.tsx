"use client";

import { useState } from "react";
import { getClientSitePreset, type LineInput } from "@/lib/billing-api";
import { formatCurrency, parseDecimalInput } from "@/lib/currency";

export interface EditableLine extends LineInput {
  quantity: string;
  unitAmount: string;
}

export function emptyLine(): EditableLine {
  return { description: "", quantity: "1", unitAmount: "0.00", siteId: null };
}

export function LineItemsEditor({
  token,
  clientId,
  lines,
  onChange,
  currency,
  disabled = false,
}: {
  token: string;
  clientId: string;
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  currency?: string;
  disabled?: boolean;
}) {
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

  const update = (index: number, patch: Partial<EditableLine>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const removeLine = (index: number) => {
    const next = lines.filter((_, i) => i !== index);
    onChange(next.length ? next : [emptyLine()]);
  };

  const pullSites = async () => {
    if (!clientId) {
      setPresetError("Choose a client first.");
      return;
    }
    setLoadingPreset(true);
    setPresetError(null);
    setPresetNotice(null);
    try {
      const { lines: preset } = await getClientSitePreset(token, clientId);
      if (preset.length === 0) {
        setPresetNotice("This client has no active sites linked yet.");
        return;
      }
      const mapped: EditableLine[] = preset.map((p) => ({
        siteId: p.siteId,
        description: p.description,
        quantity: p.quantity,
        unitAmount: Number(p.unitAmount).toFixed(2),
      }));
      // Replace blank starter rows, otherwise append.
      const existing = lines.filter((l) => l.description.trim() !== "");
      onChange([...existing, ...mapped]);

      const unpriced = preset.filter((p) => p.needsPrice).length;
      if (unpriced > 0) {
        setPresetNotice(
          `${unpriced} site${unpriced === 1 ? " has" : "s have"} no monthly contract value set — enter a price below.`
        );
      }
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : "Failed to load sites");
    } finally {
      setLoadingPreset(false);
    }
  };

  const lineTotal = (line: EditableLine) =>
    (Number(line.quantity) || 0) * (Number(line.unitAmount) || 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-security-navy-900 dark:text-security-navy-100">Line items</h3>
        <button
          type="button"
          onClick={pullSites}
          disabled={disabled || loadingPreset || !clientId}
          className="btn-secondary min-h-11 text-sm disabled:opacity-50"
        >
          {loadingPreset ? "Loading sites…" : "Pull in client's sites"}
        </button>
      </div>

      {presetError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {presetError}
        </p>
      )}
      {presetNotice && (
        <p className="rounded-lg border border-security-amber-200 bg-security-amber-50 px-3 py-2 text-sm text-security-amber-900">
          {presetNotice}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-security-navy-100 text-sm dark:divide-security-navy-700">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-security-navy-500">
              <th className="py-2 pr-2">Description</th>
              <th className="w-24 py-2 px-2 text-right">Qty</th>
              <th className="w-36 py-2 px-2 text-right">Unit price</th>
              <th className="w-32 py-2 px-2 text-right">Amount</th>
              <th className="w-12 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
            {lines.map((line, index) => (
              <tr key={index}>
                <td className="py-2 pr-2">
                  <input
                    value={line.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    disabled={disabled}
                    placeholder="Description of service"
                    className="input-modern w-full"
                    aria-label={`Line ${index + 1} description`}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    value={line.quantity}
                    onChange={(e) => update(index, { quantity: parseDecimalInput(e.target.value) })}
                    disabled={disabled}
                    inputMode="decimal"
                    className="input-modern w-full text-right"
                    aria-label={`Line ${index + 1} quantity`}
                  />
                </td>
                <td className="py-2 px-2">
                  <input
                    value={line.unitAmount}
                    onChange={(e) => update(index, { unitAmount: parseDecimalInput(e.target.value) })}
                    disabled={disabled}
                    inputMode="decimal"
                    className="input-modern w-full text-right"
                    aria-label={`Line ${index + 1} unit price`}
                  />
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-security-navy-900 dark:text-security-navy-200">
                  {formatCurrency(lineTotal(line), { currency })}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={disabled}
                    className="min-h-11 px-2 text-sm text-red-600 hover:underline disabled:opacity-40"
                    aria-label={`Remove line ${index + 1}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => onChange([...lines, emptyLine()])}
        disabled={disabled}
        className="btn-secondary min-h-11 text-sm disabled:opacity-50"
      >
        Add line
      </button>
    </div>
  );
}
