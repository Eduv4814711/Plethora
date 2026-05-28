import { format, parseISO } from "date-fns";

export type ShiftSheetRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  gender: string | null | undefined;
  phone: string | null | undefined;
  cells: ("D" | "N" | "O")[];
};

/** Minimal shift shape for building the staff × day matrix (API + roster page). */
export type MatrixShift = {
  startTime: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    gender?: string | null;
    phone?: string | null;
  };
  post: { shiftType: string | null; site: { id: string } };
};

export type MatrixEmployee = {
  id: string;
  gender?: string | null;
  phone?: string | null;
};

export function shiftCellLetter(s: MatrixShift): "D" | "N" {
  const t = s.post.shiftType;
  if (t === "night") return "N";
  if (t === "day") return "D";
  const h = parseISO(s.startTime).getHours();
  if (h >= 18 || h < 6) return "N";
  return "D";
}

export function mergeSheetEmployeeLookup(
  employees: MatrixEmployee[],
  assignedGuards?: { employee: { id: string; gender?: string | null; phone?: string | null } }[]
): MatrixEmployee[] {
  const byId = new Map<string, MatrixEmployee>();
  for (const e of employees) {
    byId.set(e.id, e);
  }
  for (const a of assignedGuards ?? []) {
    const existing = byId.get(a.employee.id);
    byId.set(a.employee.id, {
      id: a.employee.id,
      gender: existing?.gender ?? a.employee.gender ?? null,
      phone: existing?.phone ?? a.employee.phone ?? null,
    });
  }
  return [...byId.values()];
}

export function buildShiftSheetRows({
  shifts,
  calendarDays,
  siteId,
  employees,
}: {
  shifts: MatrixShift[];
  calendarDays: Date[];
  siteId: string;
  employees: MatrixEmployee[];
}): ShiftSheetRow[] {
  if (!siteId) return [];
  const sheetShifts = shifts.filter((s) => s.post.site.id === siteId);

  const employeeById = new Map<string, MatrixEmployee>();
  for (const e of employees) employeeById.set(e.id, e);

  const dayKeys = calendarDays.map((d) => format(d, "yyyy-MM-dd"));
  const keySet = new Set(dayKeys);
  const byEmpDay = new Map<string, Map<string, ("D" | "N")[]>>();

  for (const s of sheetShifts) {
    const eid = s.employee.id;
    const dk = format(parseISO(s.startTime), "yyyy-MM-dd");
    if (!keySet.has(dk)) continue;
    if (!byEmpDay.has(eid)) byEmpDay.set(eid, new Map());
    const letter = shiftCellLetter(s);
    const inner = byEmpDay.get(eid)!;
    if (!inner.has(dk)) inner.set(dk, []);
    inner.get(dk)!.push(letter);
  }

  const ids = [...new Set(sheetShifts.map((s) => s.employee.id))].sort((a, b) => {
    const sa = sheetShifts.find((x) => x.employee.id === a)!.employee;
    const sb = sheetShifts.find((x) => x.employee.id === b)!.employee;
    return (sa.lastName + sa.firstName).localeCompare(sb.lastName + sb.firstName);
  });

  return ids.map((employeeId) => {
    const sample = sheetShifts.find((s) => s.employee.id === employeeId)!;
    const empMeta = employeeById.get(employeeId);
    const cells: ("D" | "N" | "O")[] = dayKeys.map((dk) => {
      const letters = byEmpDay.get(employeeId)?.get(dk) ?? [];
      if (letters.length === 0) return "O";
      if (letters.includes("N")) return "N";
      return "D";
    });
    return {
      employeeId,
      firstName: sample.employee.firstName,
      lastName: sample.employee.lastName,
      gender: empMeta?.gender ?? sample.employee.gender ?? null,
      phone: empMeta?.phone ?? sample.employee.phone ?? null,
      cells,
    };
  });
}

export function genderPdfLabel(gender: string | null | undefined): string {
  const g = (gender ?? "").trim().toUpperCase();
  if (g === "F" || g.startsWith("F")) return "F";
  if (g === "M" || g.startsWith("M")) return "M";
  return "";
}
