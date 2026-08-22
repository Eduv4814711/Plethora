"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LeaveRequestsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/employees/leave");
  }, [router]);
  return (
    <div className="animate-fade-in p-8 text-center">
      <p className="text-security-navy-600">Redirecting to leave management…</p>
    </div>
  );
}
