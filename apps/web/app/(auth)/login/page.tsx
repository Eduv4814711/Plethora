"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AlertBanner, Button, Field, Input } from "@/components/ui";

function LoginForm() {
  const { user, login, error, setError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace("/");
    }
  }, [user, router]);

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in">
      {/* The logo carries the brand on phones, where the duty ribbon panel is
          hidden. On desktop the panel already said who this is. */}
      <img
        src="/plethora-logo.svg"
        alt="Plethora"
        className="mb-8 h-16 w-auto object-contain object-left lg:hidden"
      />

      <h1 className="page-title">Welcome back</h1>
      <p className="mt-1.5 text-sm text-security-navy-500">
        Use the email address your company owner set you up with.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-5" autoComplete="off">
        <Field label="Email" id="email">
          <Input
            name="plethora-login-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@company.com"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="space-y-1.5">
          <label htmlFor="password" className="label-text block">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              name="plethora-login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-12"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-security text-security-navy-400 transition-colors hover:bg-security-navy-50 hover:text-security-navy-700"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && (
          <AlertBanner variant="error" title={error}>
            {process.env.NODE_ENV !== "production" &&
              (error === "Login failed" || error.includes("connect") || error.includes("server") || error.includes("404")) && (
                <p className="mt-1 text-xs leading-relaxed text-red-800/80">
                  Start both servers with{" "}
                  <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[0.6875rem]">npm run dev:all</code> — web on
                  port 3000, API on 3001. First run also needs{" "}
                  <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[0.6875rem]">npm run db:push</code> and{" "}
                  <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[0.6875rem]">npm run db:seed</code>.
                </p>
              )}
          </AlertBanner>
        )}

        <Button type="submit" variant="signal" size="lg" loading={submitting} className="min-h-12 w-full">
          Sign in
        </Button>
      </form>

      <p className="mt-8 border-t border-security-navy-100 pt-6 text-sm text-security-navy-500">
        New to Plethora?{" "}
        <Link href="/register" className="font-semibold text-security-amber-700 hover:underline">
          Create a company
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
