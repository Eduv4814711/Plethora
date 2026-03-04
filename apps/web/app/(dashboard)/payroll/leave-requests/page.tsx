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
      <p className="text-neutral-500 dark:text-neutral-400">Redirecting to Leave Management…</p>
    </div>
  );
}
