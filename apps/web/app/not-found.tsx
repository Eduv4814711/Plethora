import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-canvas)] px-6">
      <div className="w-full max-w-md animate-fade-in">
        <p className="text-xs font-semibold text-security-navy-500">404</p>
        <h1 className="page-title mt-1.5">There is nothing at this address</h1>
        <p className="mt-3 text-sm leading-relaxed text-security-navy-500">
          The link may be out of date, or the module may have been renamed. Return to your operations dashboard to
          continue.
        </p>
        <Link href="/" className="btn-primary mt-6 inline-flex no-underline">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
