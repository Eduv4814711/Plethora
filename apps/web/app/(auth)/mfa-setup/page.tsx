"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MfaSetupPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return <div className="card-elevated p-8 text-center text-sm text-neutral-600">Returning to Plethora…</div>;
}
