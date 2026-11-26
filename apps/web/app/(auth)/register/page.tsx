"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { onboardCompany } from "@/lib/api";
import { AlertBanner, Button, Field, Input, SkeletonBlock } from "@/components/ui";

function RegisterFallback() {
  return (
    <div className="w-full space-y-4 animate-fade-in">
      <SkeletonBlock className="h-6 w-48" />
      <SkeletonBlock className="h-11 w-full" />
      <SkeletonBlock className="h-11 w-full" />
      <SkeletonBlock className="h-11 w-full" />
    </div>
  );
}

function RegisterFormContent() {
  const { user, loginWithResponse, error, setError } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next") ?? "/";
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const [form, setForm] = useState({
    companyName: "",
    adminName: "",
    adminEmail: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      router.replace(nextPath);
    }
  }, [user, router, nextPath]);

  if (user) return null;

  const validate = (): boolean => {
    if (!form.companyName.trim()) {
      setError("Company name is required");
      return false;
    }
    if (!form.adminName.trim()) {
      setError("Admin name is required");
      return false;
    }
    if (!form.adminEmail.trim()) {
      setError("Admin email is required");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) {
      setError("Enter a valid email address");
      return false;
    }
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return false;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return false;
    }
    setError(null);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const data = await onboardCompany({
        company: { name: form.companyName.trim() },
        admin: {
          name: form.adminName.trim(),
          email: form.adminEmail.trim().toLowerCase(),
          password: form.password,
        },
      });
      loginWithResponse(data);
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full animate-fade-in">
      <img
        src="/plethora-logo.svg"
        alt="Plethora"
        className="mb-8 h-14 w-auto object-contain object-left lg:hidden"
      />
      <h1 className="page-title">Register your company</h1>
      <p className="mt-1.5 text-sm text-security-navy-500">
        Create your security operations workspace and administrator account.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        <Field label="Company name" id="companyName">
          <Input
            type="text"
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            required
            placeholder="Acme Security"
          />
        </Field>

        <Field label="Your name" id="adminName">
          <Input
            type="text"
            value={form.adminName}
            onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
            required
            placeholder="Jane Admin"
          />
        </Field>

        <Field label="Admin email" id="adminEmail">
          <Input
            type="email"
            value={form.adminEmail}
            onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
            required
            placeholder="admin@company.com"
          />
        </Field>

        <div className="space-y-1.5">
          <label htmlFor="password" className="label-text block">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              className="pr-12"
              placeholder="At least 8 characters"
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

        <Field label="Confirm password" id="confirmPassword">
          <Input
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            required
            minLength={8}
            placeholder="Same as above"
          />
        </Field>

        {error && <AlertBanner variant="error">{error}</AlertBanner>}

        <Button type="submit" variant="primary" size="lg" loading={submitting} className="min-h-12 w-full">
          Create company &amp; sign in
        </Button>
      </form>

      <p className="mt-8 border-t border-security-navy-100 pt-6 text-sm text-security-navy-500">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-security-amber-700 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterFormContent />
    </Suspense>
  );
}
