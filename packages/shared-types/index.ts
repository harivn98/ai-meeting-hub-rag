export type Role = "owner" | "admin" | "member";

export interface User {
  id: string;
  orgId: string;
  email: string;
  role: Role;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface Meeting {
  id: string;
  orgId: string;
  title: string;
  meetingDate: string | null;
  transcriptText: string | null;
  summary: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type IngestionStatus = "pending" | "indexed" | "failed" | "skipped";

export interface MeetingDocument {
  id: string;
  meetingId: string;
  fileUrl: string;
  fileType: string | null;
  uploadedBy: string | null;
  ingestionStatus: IngestionStatus;
  ingestionError: string | null;
  createdAt: string;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  meetingId: string;
  chunkIndex: number;
  content: string;
  createdAt: string;
}

export interface AskResponse {
  answer: string;
  sources: string[];
}

export interface AuthResponse {
  token: string;
  user: User;
}
