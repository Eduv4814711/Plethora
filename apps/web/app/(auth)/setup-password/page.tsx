import { Suspense } from "react";
import SetupPasswordClient from "./setup-password-client";

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={<div className="text-sm text-security-navy-500">Loading...</div>}>
      <SetupPasswordClient />
    </Suspense>
  );
}
