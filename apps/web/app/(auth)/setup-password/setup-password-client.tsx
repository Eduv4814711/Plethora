"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { completeSetupPassword, validateSetupPasswordToken } from "@/lib/api";

export default function SetupPasswordClient() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setError("Invalid or expired setup link.");
      setLoading(false);
      return;
    }
    validateSetupPasswordToken(token)
      .then((data) => {
        if (!mounted) return;
        setValid(!!data.valid);
        setEmail(data.email);
        setName(data.name);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Invalid or expired setup link.");
        setValid(false);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await completeSetupPassword(token, password);
      setSuccess(true);
      setTimeout(() => router.push("/login"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full animate-fade-in">
      <div className="card-elevated p-8 sm:p-10 md:p-12">
        <h1 className="page-title mb-1">Set Your Password</h1>
        <p className="text-sm text-black mb-6">
          Create your password to activate your account.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-black">
            <span className="inline-block w-3 h-3 rounded-full bg-security-navy-400 animate-pulse" aria-hidden />
            Validating link...
          </div>
        ) : !valid ? (
          <div className="space-y-4">
            <div className="notice-warn">
              {error ?? "This setup link is invalid, expired, or already used."}
            </div>
            <Link href="/login" className="btn-secondary inline-flex">
              Back to Login
            </Link>
          </div>
        ) : success ? (
          <div className="notice-success">
            Password set successfully. Redirecting to login...
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="card-feature-orange p-3 text-xs text-black">
              <p>
                <span className="font-semibold">{name}</span> ({email})
              </p>
            </div>

            <div>
              <label htmlFor="password" className="label-text block mb-2">
                New password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-modern pr-12"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-security text-black hover:bg-[var(--bg-nav-hover)] border border-transparent hover:border-[var(--hairline)] transition-colors focus-ring"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="label-text block mb-2">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-modern"
                minLength={8}
                required
              />
            </div>

            {error && (
              <div className="notice-error">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full py-3 text-base" disabled={submitting}>
              {submitting ? "Saving..." : "Set Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
