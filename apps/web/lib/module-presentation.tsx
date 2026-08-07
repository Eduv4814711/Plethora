import type { ReactNode } from "react";

/**
 * Presentation for the module launcher on `/`: one icon and one short descriptor
 * per catalog module, keyed by the module path.
 *
 * Keyed rather than listed so that adding a module in
 * apps/api/src/lib/capabilities.ts and regenerating the catalog is still the only
 * step needed to make it appear — a module with no entry here falls back to
 * MODULE_ICON_FALLBACK and renders with no descriptor rather than disappearing.
 *
 * Icons follow the house style used everywhere else (see the academy sidebar in
 * app/(dashboard)/academy/layout.tsx): inline Heroicons-style outline paths, no
 * icon dependency.
 */

function icon(path: ReactNode) {
  return (
    <svg
      className="h-6 w-6 sm:h-7 sm:w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
      aria-hidden
    >
      {path}
    </svg>
  );
}

function p(d: string) {
  return icon(<path strokeLinecap="round" strokeLinejoin="round" d={d} />);
}

export const MODULE_ICON_FALLBACK: ReactNode = p(
  "M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm4 4h8m-8 4h5"
);

export const MODULE_ICONS: Record<string, ReactNode> = {
  "/overview": p(
    "M3 13h4v8H3v-8zm7-9h4v17h-4V4zm7 5h4v12h-4V9z"
  ),
  "/employees": p(
    "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
  ),
  "/employees/leave": p(
    "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zm4-7l2 2 4-4"
  ),
  "/sites": p(
    "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
  ),
  "/clients": p(
    "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
  ),
  "/rostering": p(
    "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
  ),
  "/attendance": p(
    "M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
  ),
  "/payroll": p(
    "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
  ),
  "/payroll/billing": p(
    "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
  ),
  "/tasks": p(
    "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
  ),
  "/whatsapp": p(
    "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
  ),
  "/reports": p(
    "M9 17v-6m3 6V7m3 10v-4M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
  ),
  "/approvals": p(
    "M9 12l2 2 4-4M12 3l1.9 1.36 2.31-.24 1.17 2.01 2.1.97-.54 2.27.54 2.27-2.1.97-1.17 2.01-2.31-.24L12 18l-1.9-1.36-2.31.24-1.17-2.01-2.1-.97.54-2.27L4.52 9.1l2.1-.97 1.17-2.01 2.31.24L12 3z"
  ),
  "/incidents": p(
    "M12 9v3m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
  ),
  "/documents": p(
    "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2zm2-9h6m-6 4h6"
  ),
  "/client-portal": p(
    "M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-18 0h18M12 3a15 15 0 010 18 15 15 0 010-18z"
  ),
  "/academy": p(
    "M12 14l9-5-9-5-9 5 9 5zm0 0v7m-5-9.5V17c0 1.1 2.24 2 5 2s5-.9 5-2v-5.5"
  ),
  "/audit": p(
    "M9 12h6m-6 4h6M9 8h6m3 13H6a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2z"
  ),
  "/settings": p(
    "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z"
  ),
  "/settings/migrate": p(
    "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
  ),
};

export const MODULE_DESCRIPTIONS: Record<string, string> = {
  "/overview": "Live figures and alerts",
  "/employees": "Guards, profiles and documents",
  "/employees/leave": "Requests, balances and approvals",
  "/sites": "Posts, contracts and coverage",
  "/clients": "Accounts and contacts",
  "/rostering": "Shift patterns and coverage",
  "/attendance": "Clock records and exceptions",
  "/payroll": "Runs, payslips and PAYE",
  "/payroll/billing": "Quotes, invoices and month-end",
  "/tasks": "Work items and projects",
  "/whatsapp": "Messages to guards and clients",
  "/reports": "Exports and scheduled reports",
  "/approvals": "Items waiting on you",
  "/incidents": "Reports and investigations",
  "/documents": "Certificates and expiry tracking",
  "/client-portal": "What your clients can see",
  "/academy": "Training, courses and enrolments",
  "/audit": "Who changed what, and when",
  "/settings": "Company, users and access",
  "/settings/migrate": "Bulk import and export",
};
