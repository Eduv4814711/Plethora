import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-security-navy-50">
      <div className="flex flex-col items-center gap-8 animate-fade-in">
        <div className="flex items-center gap-4">
          <span className="text-6xl font-bold text-security-navy">404</span>
          <div className="h-14 w-px bg-security-navy-300 shrink-0" aria-hidden />
          <p className="text-lg font-normal text-security-navy-600">This page could not be found.</p>
        </div>
        <Link
          href="/"
          className="btn-secondary"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
