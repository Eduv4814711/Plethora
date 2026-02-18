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
    <div className="w-full max-w-[420px] animate-fade-in">
      <div className="bg-white dark:bg-neutral-900 border border-black dark:border-white rounded-sm p-8 md:p-10">
        <div className="text-center mb-8 pb-8 border-b border-black dark:border-white">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/plethora-logo.png" alt="Plethora" className="h-14 w-auto object-contain" />
          </div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 dark:text-neutral-400 mt-2">
            Workforce & Payroll Management
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-600 dark:text-neutral-400 mb-2"
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
              className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-600 dark:text-neutral-400 mb-2"
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
            <div className="p-3 text-sm text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800 border border-black dark:border-white rounded-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 font-semibold rounded-sm border border-black dark:border-white bg-transparent dark:bg-transparent text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 outline-none"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
      <p className="text-center text-[10px] uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mt-6">
        Quick Bopha Security
      </p>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
