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
      <div className="card-elevated p-10 md:p-12">
        <h1 className="text-2xl font-semibold text-security-navy mb-1">Set Your Password</h1>
        <p className="text-sm text-security-navy-600 mb-6">
          Create your password to activate your account.
        </p>

        {loading ? (
          <p className="text-sm text-security-navy-600">Validating link...</p>
        ) : !valid ? (
          <div className="space-y-4">
            <div className="p-4 text-sm text-security-amber-900 bg-security-amber-50 border border-security-amber-200 rounded-security">
              {error ?? "This setup link is invalid, expired, or already used."}
            </div>
            <Link href="/login" className="btn-secondary inline-flex">
              Back to Login
            </Link>
          </div>
        ) : success ? (
          <div className="p-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-security">
            Password set successfully. Redirecting to login...
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="p-3 text-xs text-security-navy-600 bg-security-navy-50 rounded-security border border-security-navy-100">
              <p>
                <span className="font-medium">{name}</span> ({email})
              </p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-security-navy mb-1">
                New password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-modern pr-11"
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-security-navy-400 hover:text-security-navy-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-security-navy mb-1">
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
              <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-security">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? "Saving..." : "Set Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
