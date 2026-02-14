"use client";

import Link from "next/link";

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-800 dark:text-white mb-6">
        Reports
      </h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-4">
        Reports module coming soon. For now, use the following modules:
      </p>
      <ul className="space-y-2">
        <li>
          <Link href="/attendance" className="text-neutral-700 dark:text-neutral-300 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100">
            Attendance
          </Link>
          {" - View attendance records"}
        </li>
        <li>
          <Link href="/payroll" className="text-neutral-700 dark:text-neutral-300 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100">
            Payroll
          </Link>
          {" - View payroll runs and items"}
        </li>
      </ul>
    </div>
  );
}
