import "./globals.css";
import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth-context";

export const metadata = {
  title: "AI Meeting Hub",
  description: "Manage, search, and summarize meeting notes across your team",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
