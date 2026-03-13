"use client";

import { format, parseISO } from "date-fns";

export type CustomBlock = { type: "day" | "night" | "off"; count: number };

interface CustomPatternBuilderProps {
  blocks: CustomBlock[];
  onChange: (blocks: CustomBlock[]) => void;
  periodStart?: string;
  periodEnd?: string;
}

const BLOCK_LABELS: Record<CustomBlock["type"], string> = {
  day: "Day",
  night: "Night",
  off: "Off",
};

const BLOCK_CHARS: Record<CustomBlock["type"], string> = { day: "D", night: "N", off: "O" };

function previewBlocks(blocks: CustomBlock[], cycles = 2): string {
  const cycleLen = blocks.reduce((a, b) => a + b.count, 0);
  let s = "";
  let blockIdx = 0;
  let dayInBlock = 0;
  for (let i = 0; i < cycleLen * cycles; i++) {
    const block = blocks[blockIdx];
    s += BLOCK_CHARS[block.type];
    dayInBlock++;
    if (dayInBlock >= block.count) {
      dayInBlock = 0;
      blockIdx = (blockIdx + 1) % blocks.length;
    }
  }
  const c1 = s.slice(0, cycleLen);
  const c2 = s.slice(cycleLen, cycleLen * 2);
  return `${c1.split("").join(" ")} | ${c2.split("").join(" ")}`;
}

export function CustomPatternBuilder({ blocks, onChange, periodStart, periodEnd }: CustomPatternBuilderProps) {
  const addBlock = () => {
    onChange([...blocks, { type: "day", count: 1 }]);
  };

  const removeBlock = (idx: number) => {
    if (blocks.length <= 1) return;
    onChange(blocks.filter((_, i) => i !== idx));
  };

  const moveBlock = (idx: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    onChange(next);
  };

  const updateBlock = (idx: number, updates: Partial<CustomBlock>) => {
    onChange(
      blocks.map((b, i) => (i === idx ? { ...b, ...updates } : b))
    );
  };

  return (
    <div className="mt-2 space-y-3">
      {periodStart && periodEnd && (
        <p className="text-[11px] text-black bg-wireframe-accent rounded-[10px] px-2 py-1.5 border-2 border-security-navy-200">
          Pattern runs from <strong>{format(parseISO(periodStart), "d MMM yyyy")}</strong> to <strong>{format(parseISO(periodEnd), "d MMM yyyy")}</strong> — the full chosen date range. First block applies to the start date, then repeats to the end.
        </p>
      )}
      <div className="text-xs font-semibold text-black">Blocks (order matters)</div>
      {blocks.map((block, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => moveBlock(idx, "up")}
              disabled={idx === 0}
              className="p-0.5 text-black hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Move up"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => moveBlock(idx, "down")}
              disabled={idx === blocks.length - 1}
              className="p-0.5 text-black hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Move down"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          <select
            value={block.type}
            onChange={(e) => updateBlock(idx, { type: e.target.value as CustomBlock["type"] })}
            className="flex-1 py-1.5 px-2 text-xs rounded-[10px] border-2 border-security-navy-200 bg-white"
          >
            {(Object.keys(BLOCK_LABELS) as CustomBlock["type"][]).map((t) => (
              <option key={t} value={t}>
                {BLOCK_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={14}
            value={block.count}
            onChange={(e) => updateBlock(idx, { count: Math.max(1, Math.min(14, parseInt(e.target.value, 10) || 1)) })}
            className="w-12 py-1.5 px-2 text-xs rounded-[10px] border-2 border-security-navy-200 bg-white"
          />
          <button
            type="button"
            onClick={() => removeBlock(idx)}
            disabled={blocks.length <= 1}
            className="p-1.5 text-neutral-500 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Remove block"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addBlock}
        className="text-xs font-medium text-black hover:text-black flex items-center gap-1"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add block
      </button>
      <div className="text-[10px] text-black pt-1 font-mono bg-wireframe-accent rounded-[10px] px-2 py-1.5 border-2 border-security-navy-200">
        <span className="font-medium text-black">Preview:</span> {previewBlocks(blocks)}
      </div>
      <p className="text-[10px] text-black">
        O = Off, D = Day shift, N = Night shift
      </p>
    </div>
  );
}
