"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForUser, normalizeUserModuleAccess } from "@/lib/permissions";

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
    <div className="w-full animate-fade-in">
      <div className="card-elevated p-8 sm:p-10 md:p-12">
        <div className="text-center mb-8 pb-6 border-b border-[var(--hairline)]">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/plethora-logo.svg" alt="Plethora" className="h-24 sm:h-28 w-auto object-contain" />
          </div>
          <p className="label-text mt-2">
            Workforce & Payroll Management for Security Companies
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="label-text block mb-2"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-modern"
              placeholder="admin@quickbopha.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="label-text block mb-2"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input-modern pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-security text-black hover:bg-[var(--bg-nav-hover)] border border-transparent hover:border-[var(--hairline)] transition-colors focus-ring"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="notice-error flex-col gap-2">
              <p className="font-semibold">{error}</p>
              {(error === "Login failed" || error.includes("connect") || error.includes("server") || error.includes("404")) && (
                <p className="text-xs leading-relaxed">
                  Run <code className="code-chip">npm run dev:all</code> (or <code className="code-chip">npm run dev:api</code> in a separate terminal). Web on port 3000, API on 3001. First-time: <code className="code-chip">npm run db:push</code> and <code className="code-chip">npm run db:seed</code>.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-3 text-base"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-center text-sm text-black mt-6">
            New to Plethora?{" "}
            <Link href="/register" className="link-inline">
              Create a company
            </Link>
          </p>
        </form>
      </div>
      <p className="text-center label-text mt-6">
        Security Workforce Management
      </p>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
