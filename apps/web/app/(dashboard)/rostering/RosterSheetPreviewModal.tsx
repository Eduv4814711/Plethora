"use client";

import { createPortal } from "react-dom";
import type { ShiftSheetRow } from "@/lib/shift-sheet-matrix";
import { ShiftRosterSheet } from "./ShiftRosterSheet";

const DASHBOARD_MAIN_ID = "dashboard-main";

function getModalContainer(): Element {
  return document.getElementById(DASHBOARD_MAIN_ID) ?? document.body;
}

export function RosterSheetPreviewModal({
  open,
  onClose,
  siteName,
  periodLabel,
  days,
  rows,
  rosterSiteRules,
  rosterSheetNotes,
  rosterDayShiftGender,
  rosterNightShiftGender,
  rosterDayShiftGuardsRequired,
  rosterNightShiftGuardsRequired,
}: {
  open: boolean;
  onClose: () => void;
  siteName: string;
  periodLabel: string;
  days: Date[];
  rows: ShiftSheetRow[];
  rosterSiteRules?: string | null;
  rosterSheetNotes?: string | null;
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
  rosterDayShiftGuardsRequired?: number | null;
  rosterNightShiftGuardsRequired?: number | null;
}) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm sm:items-center">
      <div className="card-wireframe my-4 w-full max-w-[1400px] shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-700 sm:px-6">
          <div>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Roster preview</h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
              {siteName} · {periodLabel}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
        <div className="max-h-[calc(100dvh-8rem)] overflow-auto p-4 sm:p-6">
          <ShiftRosterSheet
            siteName={siteName}
            periodLabel={periodLabel}
            days={days}
            rows={rows}
            sites={[{ id: "preview", name: siteName }]}
            selectedSiteId="preview"
            onSiteTabChange={() => {}}
            rosterSiteRules={rosterSiteRules}
            rosterSheetNotes={rosterSheetNotes}
            rosterDayShiftGender={rosterDayShiftGender}
            rosterNightShiftGender={rosterNightShiftGender}
            rosterDayShiftGuardsRequired={rosterDayShiftGuardsRequired}
            rosterNightShiftGuardsRequired={rosterNightShiftGuardsRequired}
          />
        </div>
      </div>
    </div>,
    getModalContainer()
  );
}
