import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] px-6">
      <div className="w-full max-w-md animate-fade-in">
        <p className="eyebrow">404</p>
        {/* An empty screen is an instruction, not an apology: say what happened
            and hand back the one route that always works. */}
        <h1 className="page-title mt-2">There is nothing at this address</h1>
        <p className="mt-3 text-sm leading-relaxed text-security-navy-500">
          The link may be out of date, or the module may have been renamed. Everything you have access to is on
          the launcher.
        </p>
        <Link href="/" className="btn-primary mt-6 inline-flex no-underline">
          Go to all modules
        </Link>
      </div>
    </div>
  );
}
