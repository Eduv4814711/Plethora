export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-wireframe-bg p-4 sm:p-6">
      <div className="relative w-full max-w-lg">{children}</div>
    </div>
  );
}
