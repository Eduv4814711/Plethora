import { Suspense } from "react";
import SetupPasswordClient from "./setup-password-client";

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={<div className="card-elevated p-8 sm:p-10 md:p-12 text-sm text-black">Loading...</div>}>
      <SetupPasswordClient />
    </Suspense>
  );
}
