"use client";

import Link from "next/link";
import { useAuth } from "../lib/auth-context";

export default function HomePage() {
  const { user, isLoading } = useAuth();

  return (
    <main className="max-w-3xl mx-auto py-16 px-6">
      <h1 className="text-3xl font-semibold mb-2">AI Meeting Hub</h1>
      <p className="text-slate-600 mb-8">
        Manage, search, and summarize meeting notes across your team.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : user ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Signed in as <span className="font-medium">{user.email}</span>
            </p>
            <Link
              href="/dashboard"
              className="text-sm font-medium rounded-md bg-slate-900 text-white px-4 py-2 hover:bg-slate-800 transition"
            >
              Go to dashboard
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Log in to your workspace or create a new one to get started.
            </p>
            <div className="flex gap-2 shrink-0 ml-4">
              <Link
                href="/login"
                className="text-sm font-medium rounded-md border border-slate-300 px-4 py-2 hover:bg-slate-50 transition"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="text-sm font-medium rounded-md bg-slate-900 text-white px-4 py-2 hover:bg-slate-800 transition"
              >
                Sign up
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
