import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-wireframe-bg">
      <div className="flex flex-col items-center gap-8">
        <div className="flex items-center gap-4">
          <span className="text-6xl font-bold text-black">404</span>
          <div className="h-14 w-px bg-black shrink-0" aria-hidden />
          <p className="text-lg font-normal text-black">This page could not be found.</p>
        </div>
        <Link
          href="/"
          className="text-sm font-medium text-black border-2 border-black rounded-[10px] px-5 py-2.5 hover:bg-neutral-100 transition-colors"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
