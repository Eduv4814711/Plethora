export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-4 sm:px-6 sm:py-8 lg:px-8">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,152,0,0.08)_0%,transparent_45%,rgba(245,124,0,0.1)_100%)]" aria-hidden />
      <div className="relative w-full max-w-lg">{children}</div>
    </div>
  );
}
