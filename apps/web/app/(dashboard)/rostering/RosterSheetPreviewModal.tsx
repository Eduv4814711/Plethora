"use client";

import type { ShiftSheetRow } from "@/lib/shift-sheet-matrix";
import { Button, Modal } from "@/components/ui";
import { ShiftRosterSheet } from "./ShiftRosterSheet";

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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Roster preview"
      description={`${siteName} · ${periodLabel}`}
      size="xl"
      className="max-w-[1400px]"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
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
    </Modal>
  );
}
