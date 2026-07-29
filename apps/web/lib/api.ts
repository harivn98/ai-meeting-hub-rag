const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type Role = "owner" | "admin" | "member";

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

class ApiRequestError extends Error {}

function extractErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const flat = err as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      if (flat.formErrors && flat.formErrors.length > 0) return flat.formErrors[0];
      if (flat.fieldErrors) {
        const firstField = Object.values(flat.fieldErrors).flat().find(Boolean);
        if (firstField) return firstField;
      }
    }
  }
  return "Something went wrong. Please try again.";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new ApiRequestError(
      "Couldn't reach the server. Make sure the API is running and try again."
    );
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiRequestError(extractErrorMessage(data));
  }

  return data as T;
}

export function registerRequest(orgName: string, email: string, password: string) {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ orgName, email, password }),
  });
}

export function loginRequest(email: string, password: string) {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// ---- Authenticated requests (meetings, documents, analytics) ----

async function authedRequest<T>(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  return request<T>(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

export interface Meeting {
  id: string;
  org_id: string;
  title: string;
  meeting_date: string | null;
  transcript_text: string | null;
  summary: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MeetingListResponse {
  meetings: Meeting[];
  page: number;
  pageSize: number;
}

export function fetchMeetings(token: string, search: string, page: number, pageSize = 10) {
  const params = new URLSearchParams({
    search,
    page: String(page),
    pageSize: String(pageSize),
  });
  return authedRequest<MeetingListResponse>(token, `/api/meetings?${params.toString()}`);
}

export function fetchMeeting(token: string, id: string) {
  return authedRequest<Meeting>(token, `/api/meetings/${id}`);
}

export function createMeeting(
  token: string,
  input: { title: string; meetingDate?: string; transcriptText?: string }
) {
  return authedRequest<Meeting>(token, "/api/meetings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function summarizeMeeting(token: string, id: string) {
  return authedRequest<Meeting>(token, `/api/meetings/${id}/summarize`, {
    method: "POST",
  });
}

export function askQuestion(token: string, id: string, question: string) {
  return authedRequest<{ answer: string; sources: string[] }>(
    token,
    `/api/meetings/${id}/ask`,
    {
      method: "POST",
      body: JSON.stringify({ question }),
    }
  );
}

export type IngestionStatus = "pending" | "indexed" | "failed" | "skipped";

export interface MeetingDocument {
  id: string;
  meeting_id: string;
  file_url: string;
  file_type: string | null;
  uploaded_by: string | null;
  ingestion_status: IngestionStatus;
  ingestion_error: string | null;
  created_at: string;
}

export async function uploadDocument(token: string, meetingId: string, file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/meetings/${meetingId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiRequestError(extractErrorMessage(data));
  }
  return data as MeetingDocument;
}

export function fetchDocuments(token: string, meetingId: string) {
  return authedRequest<{ documents: MeetingDocument[] }>(
    token,
    `/api/meetings/${meetingId}/documents`
  );
}

export function fileUrl(relativeUrl: string) {
  return `${API_URL}${relativeUrl}`;
}

export interface AnalyticsSummary {
  meetingsPerWeek: { week: string; count: number }[];
  topContributors: { user_id: string; email: string; meeting_count: number }[];
  totals: { total_meetings: number; summarized_meetings: number };
}

export function fetchAnalytics(token: string) {
  return authedRequest<AnalyticsSummary>(token, "/api/meetings/analytics/summary");
}
