"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { onboardCompany } from "@/lib/api";

function RegisterForm() {
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
      <div className="card-elevated p-10 md:p-12">
        <div className="text-center mb-8 pb-8 border-b-2 border-black">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/plethora-logo.svg" alt="Plethora" className="h-[7.5rem] w-auto object-contain" />
          </div>
          <p className="text-xs font-medium uppercase tracking-widest text-black mt-2">
            Register your company
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="companyName"
              className="block text-xs font-semibold uppercase tracking-wider text-black mb-2"
            >
              Company name
            </label>
            <input
              id="companyName"
              type="text"
              value={form.companyName}
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
              required
              className="input-modern"
              placeholder="Acme Security"
            />
          </div>

          <div className="pt-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-black mb-3">
              Admin user for this company
            </p>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="adminName"
                  className="block text-xs font-semibold uppercase tracking-wider text-black mb-2"
                >
                  Your name
                </label>
                <input
                  id="adminName"
                  type="text"
                  value={form.adminName}
                  onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
                  required
                  className="input-modern"
                  placeholder="Jane Admin"
                />
              </div>
              <div>
                <label
                  htmlFor="adminEmail"
                  className="block text-xs font-semibold uppercase tracking-wider text-black mb-2"
                >
                  Email
                </label>
                <input
                  id="adminEmail"
                  type="email"
                  value={form.adminEmail}
                  onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                  required
                  className="input-modern"
                  placeholder="admin@company.com"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-wider text-black mb-2"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                    minLength={8}
                    className="input-modern pr-12"
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-black hover:bg-neutral-100 border border-transparent hover:border-black transition-colors"
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
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold uppercase tracking-wider text-black mb-2"
                >
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  required
                  minLength={8}
                  className="input-modern"
                  placeholder="Same as above"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 text-sm text-black bg-white border-2 border-black rounded-[10px]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-3"
          >
            {submitting ? "Creating account..." : "Create company & sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-black mt-6">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold underline hover:no-underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return <RegisterForm />;
}
