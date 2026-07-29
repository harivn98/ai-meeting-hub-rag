"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth-context";
import { fetchAnalytics, type AnalyticsSummary } from "../../../lib/api";

export default function AnalyticsPage() {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const canView = user?.role === "owner" || user?.role === "admin";

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    } else if (!isLoading && user && !canView) {
      router.replace("/dashboard");
    }
  }, [isLoading, user, canView, router]);

  useEffect(() => {
    if (!token || !canView) return;
    fetchAnalytics(token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load analytics"))
      .finally(() => setLoading(false));
  }, [token, canView]);

  if (isLoading || !user || !canView || loading) {
    return (
      <main className="max-w-3xl mx-auto py-16 px-6">
        <p className="text-slate-500 text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto py-12 px-6">
      <Link href="/dashboard" className="text-sm text-slate-600 underline">
        ← Back to dashboard
      </Link>
      <h1 className="text-3xl font-semibold mt-4 mb-8">Analytics</h1>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-6">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">Total meetings</p>
              <p className="text-3xl font-semibold mt-1">{data.totals.total_meetings}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">Summarized</p>
              <p className="text-3xl font-semibold mt-1">{data.totals.summarized_meetings}</p>
            </div>
          </div>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm mb-6">
            <h2 className="font-medium mb-3">Meetings per week (last 12)</h2>
            {data.meetingsPerWeek.length === 0 ? (
              <p className="text-sm text-slate-400">No data yet.</p>
            ) : (
              <ul className="space-y-1">
                {data.meetingsPerWeek.map((row) => (
                  <li key={row.week} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {new Date(row.week).toLocaleDateString()}
                    </span>
                    <span className="font-medium">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-medium mb-3">Top contributors</h2>
            {data.topContributors.length === 0 ? (
              <p className="text-sm text-slate-400">No data yet.</p>
            ) : (
              <ul className="space-y-1">
                {data.topContributors.map((row) => (
                  <li key={row.user_id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">{row.email}</span>
                    <span className="font-medium">{row.meeting_count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
