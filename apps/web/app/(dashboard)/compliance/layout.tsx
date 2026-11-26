"use client";

import { usePathname } from "next/navigation";
import { PageShell, SubNav } from "@/components/ui";

const NAV_TABS = [
  { href: "/compliance", label: "Executive Hub", exact: true },
  { href: "/compliance/company", label: "Obligations Register" },
  { href: "/compliance/legal", label: "Legal & CCMA" },
  { href: "/compliance/reports", label: "Tender & Reports" },
];

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <PageShell width="wide">
      <SubNav items={NAV_TABS} pathname={pathname} ariaLabel="Compliance sections" />
      <div>{children}</div>
    </PageShell>
  );
}
