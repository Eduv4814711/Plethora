"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { completeSetupPassword, validateSetupPasswordToken, PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENTS_HINT } from "@/lib/api";
import { AlertBanner, Button, Field, Input } from "@/components/ui";

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
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
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
      <h1 className="page-title">Set your password</h1>
      <p className="mt-1.5 text-sm text-security-navy-500 mb-6">
        Choose a password for your account. This link can only be used once.
      </p>

      {loading ? (
        <p className="text-sm text-security-navy-600">Validating link...</p>
      ) : !valid ? (
        <div className="space-y-4">
          <AlertBanner variant="warning">
            {error ?? "This setup link is invalid, expired, or already used."}
          </AlertBanner>
          <Link href="/login" className="btn-secondary inline-flex no-underline">
            Back to login
          </Link>
        </div>
      ) : success ? (
        <AlertBanner variant="success">
          Password set successfully. Redirecting to login...
        </AlertBanner>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="rounded-security border border-security-navy-100 bg-security-navy-50 p-3 text-xs text-security-navy-600">
            <p>
              <span className="font-medium text-security-navy-900">{name}</span> ({email})
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="label-text block">
              New password
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
                placeholder={`Minimum ${PASSWORD_MIN_LENGTH} characters`}
                minLength={PASSWORD_MIN_LENGTH}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-security p-2 text-security-navy-400 hover:text-security-navy-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-security-navy-500">{PASSWORD_REQUIREMENTS_HINT}</p>
          </div>

          <Field label="Confirm password" id="confirmPassword">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
          </Field>

          {error && <AlertBanner variant="error">{error}</AlertBanner>}

          <Button type="submit" variant="primary" size="lg" loading={submitting} className="w-full">
            Set password
          </Button>
        </form>
      )}
    </div>
  );
}
