"use client";

import Link from "next/link";

export function BillingAccessRestricted() {
  return (
    <main className="animate-fade-in mx-auto max-w-2xl py-12">
      <div className="rounded-security-lg border border-security-navy-200 bg-white p-8 text-center shadow-security-card">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-security-amber-50 text-security-amber-700">
          <svg
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>

        <h1 className="mt-4 text-xl font-bold tracking-tight text-security-navy-900">
          Access Restricted: Client Billing
        </h1>

        <p className="mt-2 text-sm text-security-navy-600 leading-relaxed">
          Your user account does not currently have permission to view or manage Client Billing.
          Access to client accounts, site billing rates, quotes, and invoices requires the{" "}
          <code className="rounded bg-security-navy-100 px-1.5 py-0.5 font-mono text-xs text-security-navy-800">
            /payroll/billing
          </code>{" "}
          module capability.
        </p>

        <div className="mt-4 rounded-security border border-security-navy-100 bg-security-navy-50/70 p-4 text-left text-xs text-security-navy-700">
          <p className="font-semibold text-security-navy-900">How to get access:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>An organization administrator or owner can grant this capability under <strong>Settings → User Access</strong>.</li>
            <li>If you are a system administrator, switch to the company owner account or grant your account the required permissions.</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="btn-primary min-h-10 px-5"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/settings"
            className="btn-secondary min-h-10 px-5"
          >
            Go to Settings
          </Link>
        </div>
      </div>
    </main>
  );
}
