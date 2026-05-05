import { redirect } from "next/navigation";

/**
 * The Academy Audit Logs page has been merged into the Activity & audit hub.
 * It now lives as the "Audit log" tab of `/academy/activity`.
 */
export default function AcademyAuditRedirectPage() {
  redirect("/academy/activity?view=audit");
}
