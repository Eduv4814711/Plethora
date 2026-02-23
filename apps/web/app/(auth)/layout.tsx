export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-4 sm:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-200 via-transparent to-transparent dark:from-neutral-900/50 pointer-events-none" />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}
