import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { SettingsProvider } from "@/lib/settings-context";
import { ThemeApplier } from "@/components/theme-applier";

export const metadata: Metadata = {
  title: "Plethora - Workforce & Payroll",
  description: "Workforce operations and payroll management for Quick Bopha Security",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <AuthProvider>
          <SettingsProvider>
            <ThemeApplier />
            {children}
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
