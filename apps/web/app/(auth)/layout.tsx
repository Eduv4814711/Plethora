export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-security-navy-50 p-4 sm:p-6">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.03)_0%,transparent_50%,rgba(245,158,11,0.04)_100%)]" aria-hidden />
      <div className="relative w-full max-w-lg">{children}</div>
    </div>
  );
}
