import type { SiteRosterShiftCode, SiteRosterShiftType } from "@prisma/client";

export function shiftCodeToType(code: SiteRosterShiftCode): SiteRosterShiftType {
  switch (code) {
    case "D":
      return "day";
    case "N":
      return "night";
    case "O":
      return "off";
    case "L":
      return "leave";
    case "SL":
      return "sick_leave";
    case "TR":
      return "training";
    case "SB":
      return "standby";
    case "AWOL":
      return "awol";
    case "R":
      return "replaced";
    default:
      return "unassigned";
  }
}

export function countsTowardCoverage(shiftType: SiteRosterShiftType): boolean {
  return shiftType === "day" || shiftType === "night";
}

export function isWorkingShiftType(shiftType: SiteRosterShiftType): boolean {
  return countsTowardCoverage(shiftType);
}
