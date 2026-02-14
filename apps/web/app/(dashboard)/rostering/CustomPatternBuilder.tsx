"use client";

export type CustomBlock = { type: "day" | "night" | "off"; count: number };

interface CustomPatternBuilderProps {
  blocks: CustomBlock[];
  onChange: (blocks: CustomBlock[]) => void;
}

const BLOCK_LABELS: Record<CustomBlock["type"], string> = {
  day: "Day",
  night: "Night",
  off: "Off",
};

function previewBlocks(blocks: CustomBlock[], cycles = 2): string {
  const chars: Record<CustomBlock["type"], string> = { day: "D", night: "N", off: "O" };
  const cycleLen = blocks.reduce((a, b) => a + b.count, 0);
  let s = "";
  let blockIdx = 0;
  let dayInBlock = 0;
  for (let i = 0; i < cycleLen * cycles; i++) {
    const block = blocks[blockIdx];
    s += chars[block.type];
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

export function CustomPatternBuilder({ blocks, onChange }: CustomPatternBuilderProps) {
  const addBlock = () => {
    onChange([...blocks, { type: "day", count: 1 }]);
  };

  const removeBlock = (idx: number) => {
    if (blocks.length <= 1) return;
    onChange(blocks.filter((_, i) => i !== idx));
  };

  const updateBlock = (idx: number, updates: Partial<CustomBlock>) => {
    onChange(
      blocks.map((b, i) => (i === idx ? { ...b, ...updates } : b))
    );
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Blocks</div>
      {blocks.map((block, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <select
            value={block.type}
            onChange={(e) => updateBlock(idx, { type: e.target.value as CustomBlock["type"] })}
            className="flex-1 py-1.5 px-2 text-xs rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900"
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
            className="w-12 py-1.5 px-2 text-xs rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900"
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
        className="text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 flex items-center gap-1"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add block
      </button>
      <div className="text-[10px] text-neutral-500 dark:text-neutral-500 pt-1">
        Preview: {previewBlocks(blocks)}
      </div>
    </div>
  );
}
