"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { createMeeting, fetchMeetings, type Meeting } from "../../lib/api";

const PAGE_SIZE = 10;

export default function DashboardPage() {
  const { user, token, isLoading, logout } = useAuth();
  const router = useRouter();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  async function loadMeetings() {
    if (!token) return;
    setListLoading(true);
    setListError(null);
    try {
      const result = await fetchMeetings(token, search, page, PAGE_SIZE);
      setMeetings(result.meetings);
      setHasMore(result.meetings.length === PAGE_SIZE);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load meetings");
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    loadMeetings();
  }

  async function handleCreateSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreateError(null);
    setIsCreating(true);
    try {
      await createMeeting(token, {
        title,
        meetingDate: meetingDate || undefined,
        transcriptText: transcriptText || undefined,
      });
      setTitle("");
      setMeetingDate("");
      setTranscriptText("");
      setShowCreate(false);
      setPage(1);
      loadMeetings();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create meeting");
    } finally {
      setIsCreating(false);
    }
  }

  if (isLoading || !user) {
    return (
      <main className="max-w-4xl mx-auto py-16 px-6">
        <p className="text-slate-500 text-sm">Loading…</p>
      </main>
    );
  }

  const canViewAnalytics = user.role === "owner" || user.role === "admin";

  return (
    <main className="max-w-4xl mx-auto py-12 px-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {user.email} · <span className="capitalize">{user.role}</span>
          </p>
        </div>
        <div className="flex items-center gap-4">
          {canViewAnalytics && (
            <Link
              href="/dashboard/analytics"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 underline"
            >
              Analytics
            </Link>
          )}
          <button
            onClick={logout}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 underline"
          >
            Log out
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 mb-4">
        <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search meetings by title…"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <button
            type="submit"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Search
          </button>
        </form>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="shrink-0 rounded-md bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800"
        >
          {showCreate ? "Cancel" : "New meeting"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-4 mb-6"
        >
          {createError && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
              {createError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Weekly sync"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Meeting date</label>
            <input
              type="datetime-local"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Transcript (optional)</label>
            <textarea
              value={transcriptText}
              onChange={(e) => setTranscriptText(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              placeholder="Paste transcript text here — you can also upload a file after creating the meeting."
            />
          </div>
          <button
            type="submit"
            disabled={isCreating}
            className="rounded-md bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 disabled:opacity-60"
          >
            {isCreating ? "Creating…" : "Create meeting"}
          </button>
        </form>
      )}

      {listError && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-4">
          {listError}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        {listLoading ? (
          <p className="p-6 text-sm text-slate-500">Loading meetings…</p>
        ) : meetings.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No meetings yet. Create one to get started.</p>
        ) : (
          meetings.map((meeting) => (
            <Link
              key={meeting.id}
              href={`/dashboard/meetings/${meeting.id}`}
              className="block p-4 hover:bg-slate-50 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{meeting.title}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {meeting.meeting_date
                      ? new Date(meeting.meeting_date).toLocaleString()
                      : "No date set"}
                  </p>
                </div>
                {meeting.summary && (
                  <span className="text-xs rounded-full bg-emerald-50 text-emerald-700 px-2 py-1">
                    Summarized
                  </span>
                )}
              </div>
            </Link>
          ))
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Previous
        </button>
        <span className="text-sm text-slate-500">Page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasMore}
          className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </main>
  );
}
