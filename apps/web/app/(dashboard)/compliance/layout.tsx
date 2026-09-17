"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_TABS = [
  { href: "/compliance", label: "Executive Hub", exact: true },
  { href: "/compliance/company", label: "Obligations Register" },
  { href: "/compliance/statutory", label: "Statutory & EMP201" },
  { href: "/compliance/funds", label: "Funds & PSSPF" },
  { href: "/compliance/legal", label: "Legal & CCMA" },
  { href: "/compliance/cash-control", label: "Protected Cash Floor" },
  { href: "/compliance/reports", label: "Tender & Reports" },
];

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="border-b border-security-navy-100 bg-white/60 backdrop-blur-sm -mx-4 -mt-4 px-4 pt-3 sm:-mx-6 sm:px-6">
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
          {NAV_TABS.map((tab) => {
            const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex items-center px-3.5 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? "border-security-amber-500 text-security-amber-800 bg-security-amber-50/50"
                    : "border-transparent text-security-navy-500 hover:text-security-navy-900 hover:border-security-navy-200"
                }`}
              >
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div>{children}</div>
    </div>
  );
}
