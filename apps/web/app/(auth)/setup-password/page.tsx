import { Suspense } from "react";
import SetupPasswordClient from "./setup-password-client";

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={<div className="card-elevated p-10 md:p-12 text-sm text-security-navy-600">Loading...</div>}>
      <SetupPasswordClient />
    </Suspense>
  );
}
