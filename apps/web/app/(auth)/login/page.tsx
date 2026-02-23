"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function LoginForm() {
  const { user, login, error, setError } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      <div className="card-wireframe p-8 md:p-10 shadow-soft dark:shadow-soft-dark">
        <div className="text-center mb-8 pb-8 border-b border-neutral-200 dark:border-neutral-700">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/plethora-logo.png" alt="Plethora" className="h-14 w-auto object-contain" />
          </div>
          <p className="text-xs font-medium uppercase tracking-widest text-neutral-500 dark:text-neutral-400 mt-2">
            Workforce & Payroll Management
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-400 mb-2"
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
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-neutral-400 mb-2"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="input-modern"
            />
          </div>

          {error && (
            <div className="p-4 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-md">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-3"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
      <p className="text-center text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mt-6">
        Quick Bopha Security
      </p>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
