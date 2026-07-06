"use client";

import Link from "next/link";

type SiteOperationalActionsProps = {
  siteId: string;
  layout?: "row" | "stack";
  className?: string;
};

/** Primary shortcuts from Sites into rostering and attendance for one site. */
export function SiteOperationalActions({
  siteId,
  layout = "row",
  className = "",
}: SiteOperationalActionsProps) {
  const rosterHref = `/rostering?siteId=${encodeURIComponent(siteId)}`;
  const attendanceHref = `/attendance?siteId=${encodeURIComponent(siteId)}`;

  return (
    <div
      className={`flex gap-2 ${
        layout === "stack" ? "flex-col w-full sm:flex-row sm:w-auto" : "flex-col sm:flex-row flex-wrap"
      } ${className}`}
    >
      <Link href={rosterHref} className="btn-primary text-center text-sm whitespace-nowrap">
        Build roster
      </Link>
      <Link href={attendanceHref} className="btn-secondary text-center text-sm whitespace-nowrap">
        Record attendance
      </Link>
    </div>
  );
}
