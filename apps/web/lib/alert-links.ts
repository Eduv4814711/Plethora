import type { OperationalAlert } from "./msr-api";

export interface AlertFixTarget {
  href: string;
  /** Verb for the button — says what the user is about to do, not just "view". */
  label: string;
}

function metaString(alert: OperationalAlert, key: string): string | undefined {
  const value = alert.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Where to send someone so they can actually FIX an alert, not merely look at it.
 *
 * Kept deliberately close to `alertLinkUrl` in
 * apps/api/src/modules/alerts/alerts.service.ts, which builds the same links for
 * WhatsApp/in-app notifications — change both together.
 */
export function alertFixTarget(alert: OperationalAlert): AlertFixTarget | null {
  switch (alert.sourceModule) {
    case "ROSTERING": {
      if (!alert.siteId) return { href: "/rostering", label: "Open rostering" };
      // The site roster page scrolls to and focuses `#roster-issue-<alertId>`, and the
      // continuity panel offers "Find a replacement" when the issue carries a date+shift.
      const params = new URLSearchParams({ issue: alert.id });
      return { href: `/rostering/sites/${alert.siteId}?${params}`, label: "Fix roster" };
    }

    case "ATTENDANCE": {
      // Alerts mirror an AttendanceException; the exceptions queue is where they are
      // approved, rejected or converted to an absence.
      const params = new URLSearchParams({ status: "OPEN" });
      if (alert.siteId) params.set("siteId", alert.siteId);
      return { href: `/attendance/exceptions?${params}`, label: "Review exception" };
    }

    case "PAYROLL": {
      // "Payroll blocked because attendance is not approved" — the blocker is in
      // attendance, so sending them to /payroll would just bounce them back.
      const params = new URLSearchParams({ status: "OPEN", severity: "CRITICAL" });
      const periodStart = metaString(alert, "periodStart");
      const periodEnd = metaString(alert, "periodEnd");
      if (periodStart) params.set("start", periodStart);
      if (periodEnd) params.set("end", periodEnd);
      return { href: `/attendance/exceptions?${params}`, label: "Clear blockers" };
    }

    case "TASKS":
      return alert.sourceId
        ? { href: `/tasks/${alert.sourceId}`, label: "Open task" }
        : { href: "/tasks", label: "Open tasks" };

    case "INCIDENTS":
      return alert.sourceId
        ? { href: `/incidents/${alert.sourceId}`, label: "Open incident" }
        : { href: "/incidents", label: "Open incidents" };

    case "SITES":
      // Contract expiry — fixed by editing the site's contract dates.
      return alert.siteId
        ? { href: `/sites/${alert.siteId}`, label: "Open site" }
        : { href: "/sites", label: "Open sites" };

    case "DOCUMENTS":
      // /documents has no deep-link params yet, so this lands on the list.
      return { href: "/documents", label: "Open documents" };

    case "APPROVALS":
      return { href: "/approvals", label: "Review approval" };

    default:
      return null;
  }
}
