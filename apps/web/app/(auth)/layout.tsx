export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-security-navy-50 p-4 sm:p-6">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(245,124,0,0.04)_0%,transparent_50%,rgba(255,152,0,0.06)_100%)]" aria-hidden />
      <div className="relative w-full max-w-lg">{children}</div>
    </div>
  );
}
