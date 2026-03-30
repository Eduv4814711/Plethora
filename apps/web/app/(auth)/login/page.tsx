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
      const moduleList = normalizeUserModuleAccess(user.moduleAccess);
      const suggestedRoute = getDefaultRouteForUser(user);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/88a7285e-a4b7-491f-ab73-2cd80dfe89c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb2299'},body:JSON.stringify({sessionId:'fb2299',runId:'pre-fix',hypothesisId:'H1',location:'apps/web/app/(auth)/login/page.tsx:20',message:'login user state resolved',data:{role:user.role,moduleCount:moduleList?.length ?? 0,suggestedRoute},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      router.replace("/");
    }
  }, [user, router]);

  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/88a7285e-a4b7-491f-ab73-2cd80dfe89c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb2299'},body:JSON.stringify({sessionId:'fb2299',runId:'pre-fix',hypothesisId:'H2',location:'apps/web/app/(auth)/login/page.tsx:31',message:'login submit start',data:{hasEmail:email.includes("@"),passwordLength:password.length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await login(email, password);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/88a7285e-a4b7-491f-ab73-2cd80dfe89c9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fb2299'},body:JSON.stringify({sessionId:'fb2299',runId:'pre-fix',hypothesisId:'H3',location:'apps/web/app/(auth)/login/page.tsx:34',message:'login submit success pushing root',data:{pushTarget:'/'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
      <div className="card-elevated p-10 md:p-12">
        <div className="text-center mb-8 pb-8 border-b-2 border-neutral-200">
          <div className="inline-flex items-center justify-center mb-4">
            <img src="/plethora-logo.svg" alt="Plethora" className="h-[7.5rem] w-auto object-contain" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-security-navy-500 mt-2">
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
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-security text-security-navy-600 hover:bg-security-navy-50 border border-transparent hover:border-security-navy-300 transition-colors"
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
            <div className="p-4 text-sm text-security-navy bg-security-amber-50 border-2 border-security-amber-200 rounded-security space-y-2">
              <p className="font-medium">{error}</p>
              {(error === "Login failed" || error.includes("connect") || error.includes("server") || error.includes("404")) && (
                <p className="text-xs mt-2 text-security-navy-600">
                  Run <code className="bg-security-navy-100 px-1.5 py-0.5 rounded text-security-navy-700 font-mono">npm run dev:all</code> (or <code className="bg-security-navy-100 px-1.5 py-0.5 rounded text-security-navy-700 font-mono">npm run dev:api</code> in a separate terminal). Web on port 3000, API on 3001. First-time: <code className="bg-security-navy-100 px-1.5 py-0.5 rounded text-security-navy-700 font-mono">npm run db:push</code> and <code className="bg-security-navy-100 px-1.5 py-0.5 rounded text-security-navy-700 font-mono">npm run db:seed</code>.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full py-3"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>

          <p className="text-center text-sm text-security-navy-600 mt-6">
            New to Plethora?{" "}
            <Link href="/register" className="font-semibold text-security-navy hover:underline">
              Create a company
            </Link>
          </p>
        </form>
      </div>
      <p className="text-center text-xs font-medium uppercase tracking-widest text-security-navy-400 mt-6">
        Security Workforce Management
      </p>
    </div>
  );
}

export default function LoginPage() {
  return <LoginForm />;
}
