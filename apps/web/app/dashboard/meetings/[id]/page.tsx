"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "../../../../lib/auth-context";
import {
  askQuestion,
  fetchDocuments,
  fetchMeeting,
  fileUrl,
  summarizeMeeting,
  uploadDocument,
  type Meeting,
  type MeetingDocument,
} from "../../../../lib/api";

export default function MeetingDetailPage() {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const meetingId = params.id;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [documents, setDocuments] = useState<MeetingDocument[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);

  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  async function loadMeeting() {
    if (!token) return;
    setDetailLoading(true);
    setLoadError(null);
    try {
      const [meetingResult, docsResult] = await Promise.all([
        fetchMeeting(token, meetingId),
        fetchDocuments(token, meetingId),
      ]);
      setMeeting(meetingResult);
      setDocuments(docsResult.documents);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load meeting");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadMeeting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, meetingId]);

  // Ingestion (extract -> embed -> store) happens asynchronously after
  // upload, so poll while any document is still 'pending' and stop once
  // everything has settled into indexed/failed/skipped.
  useEffect(() => {
    const hasPending = documents.some((doc) => doc.ingestion_status === "pending");
    if (!hasPending || !token) return;
    const interval = setInterval(() => {
      fetchDocuments(token, meetingId)
        .then((result) => setDocuments(result.documents))
        .catch(() => {
          /* ignore transient polling errors */
        });
    }, 3000);
    return () => clearInterval(interval);
  }, [documents, token, meetingId]);

  const indexedDocumentCount = documents.filter(
    (doc) => doc.ingestion_status === "indexed"
  ).length;
  const canAsk = Boolean(meeting?.transcript_text) || indexedDocumentCount > 0;

  async function handleSummarize() {
    if (!token) return;
    setSummarizeError(null);
    setIsSummarizing(true);
    try {
      const updated = await summarizeMeeting(token, meetingId);
      setMeeting(updated);
    } catch (err) {
      setSummarizeError(
        err instanceof Error ? err.message : "Failed to summarize meeting"
      );
    } finally {
      setIsSummarizing(false);
    }
  }

  async function handleAsk(e: FormEvent) {
    e.preventDefault();
    if (!token || !question.trim()) return;
    setAskError(null);
    setAnswer(null);
    setSources([]);
    setIsAsking(true);
    try {
      const result = await askQuestion(token, meetingId, question.trim());
      setAnswer(result.answer);
      setSources(result.sources || []);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : "Failed to get an answer");
    } finally {
      setIsAsking(false);
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      await uploadDocument(token, meetingId, file);
      const docsResult = await fetchDocuments(token, meetingId);
      setDocuments(docsResult.documents);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  }

  if (isLoading || !user || detailLoading) {
    return (
      <main className="max-w-3xl mx-auto py-16 px-6">
        <p className="text-slate-500 text-sm">Loading…</p>
      </main>
    );
  }

  if (loadError || !meeting) {
    return (
      <main className="max-w-3xl mx-auto py-16 px-6">
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {loadError || "Meeting not found"}
        </div>
        <Link href="/dashboard" className="text-sm text-slate-600 underline mt-4 inline-block">
          ← Back to dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto py-12 px-6">
      <Link href="/dashboard" className="text-sm text-slate-600 underline">
        ← Back to dashboard
      </Link>

      <h1 className="text-3xl font-semibold mt-4 mb-1">{meeting.title}</h1>
      <p className="text-sm text-slate-500 mb-8">
        {meeting.meeting_date
          ? new Date(meeting.meeting_date).toLocaleString()
          : "No date set"}
      </p>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <h2 className="font-medium mb-2">Transcript</h2>
        {meeting.transcript_text ? (
          <p className="text-sm text-slate-600 whitespace-pre-wrap">
            {meeting.transcript_text}
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            No transcript text yet. Upload a document below or edit via the API.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium">AI summary</h2>
          <button
            onClick={handleSummarize}
            disabled={isSummarizing || !meeting.transcript_text}
            className="text-sm font-medium rounded-md bg-slate-900 text-white px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50"
          >
            {isSummarizing ? "Summarizing…" : "Generate summary"}
          </button>
        </div>
        {summarizeError && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-2">
            {summarizeError}
          </div>
        )}
        {meeting.summary ? (
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{meeting.summary}</p>
        ) : (
          <p className="text-sm text-slate-400">
            No summary yet. This calls the ai-service, which runs the local Ollama model.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm mb-6">
        <h2 className="font-medium mb-1">Ask a question about this meeting</h2>
        <p className="text-xs text-slate-400 mb-3">
          Answers draw on the transcript{indexedDocumentCount > 0 && " and the indexed documents below"}.
        </p>
        <form onSubmit={handleAsk} className="flex gap-2 mb-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What did we decide about the launch date?"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <button
            type="submit"
            disabled={isAsking || !canAsk}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {isAsking ? "Asking…" : "Ask"}
          </button>
        </form>
        {askError && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-2">
            {askError}
          </div>
        )}
        {answer && (
          <div className="rounded-md bg-slate-50 border border-slate-200 text-sm text-slate-700 px-3 py-2 whitespace-pre-wrap mb-2">
            {answer}
          </div>
        )}
        {sources.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none">
              {sources.length} retrieved document excerpt{sources.length > 1 ? "s" : ""} used
            </summary>
            <ul className="mt-2 space-y-2">
              {sources.map((source, i) => (
                <li
                  key={i}
                  className="rounded-md bg-slate-50 border border-slate-200 px-2 py-1.5 whitespace-pre-wrap"
                >
                  {source}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Documents</h2>
          <label className="text-sm font-medium rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
            {isUploading ? "Uploading…" : "Upload file"}
            <input
              type="file"
              className="hidden"
              onChange={handleUpload}
              disabled={isUploading}
              accept=".pdf,.txt,.md,.docx,.mp3,.wav,.m4a"
            />
          </label>
        </div>
        {uploadError && (
          <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 mb-2">
            {uploadError}
          </div>
        )}
        {documents.length === 0 ? (
          <p className="text-sm text-slate-400">No documents uploaded yet.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li key={doc.id} className="text-sm">
                <a
                  href={fileUrl(doc.file_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-700 underline hover:text-slate-900"
                >
                  {doc.file_url.split("/").pop()}
                </a>{" "}
                <span className="text-slate-400">
                  ({doc.file_type || "unknown type"},{" "}
                  {new Date(doc.created_at).toLocaleDateString()})
                </span>{" "}
                <span
                  title={doc.ingestion_error || undefined}
                  className={
                    "text-xs rounded-full px-2 py-0.5 " +
                    (doc.ingestion_status === "indexed"
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : doc.ingestion_status === "pending"
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : doc.ingestion_status === "failed"
                      ? "bg-red-50 text-red-700 border border-red-200"
                      : "bg-slate-50 text-slate-500 border border-slate-200")
                  }
                >
                  {doc.ingestion_status === "indexed" && "Indexed for Q&A"}
                  {doc.ingestion_status === "pending" && "Indexing…"}
                  {doc.ingestion_status === "failed" && "Indexing failed"}
                  {doc.ingestion_status === "skipped" && "Not indexed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
