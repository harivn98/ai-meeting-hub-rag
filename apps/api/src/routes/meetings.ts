import { Router } from "express";
import { z } from "zod";
import { pool } from "../config/db";
import { requireAuth, requireRole } from "../middleware/auth";
import { upload } from "../middleware/upload";
import { extractText, isExtractable } from "../utils/extractText";

const AI_SERVICE_URL = process.env.AI_SERVICE_URL;

// Chunk + embed a document's text via the AI service and store the result
// in pgvector, updating the document's ingestion_status along the way.
async function ingestDocument(documentId: string, meetingId: string, text: string) {
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/documents/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: documentId, meeting_id: meetingId, text }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      await pool.query(
        "UPDATE documents SET ingestion_status = 'failed', ingestion_error = $1 WHERE id = $2",
        [`AI service returned ${resp.status}: ${body.slice(0, 500)}`, documentId]
      );
      return;
    }
    await pool.query(
      "UPDATE documents SET ingestion_status = 'indexed', ingestion_error = NULL WHERE id = $1",
      [documentId]
    );
  } catch (err) {
    console.error("Document ingestion failed", err);
    await pool.query(
      "UPDATE documents SET ingestion_status = 'failed', ingestion_error = $1 WHERE id = $2",
      [err instanceof Error ? err.message : "Unknown ingestion error", documentId]
    );
  }
}

const router = Router();
router.use(requireAuth);

const createMeetingSchema = z.object({
  title: z.string().min(1),
  meetingDate: z.string().optional(),
  transcriptText: z.string().optional(),
});

// List meetings for the caller's org, with pagination + basic search
router.get("/", async (req, res) => {
  const { orgId } = req.auth!;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Number(req.query.pageSize) || 10);
  const search = (req.query.search as string) || "";

  try {
    const result = await pool.query(
      `SELECT id, title, meeting_date, summary, created_at
       FROM meetings
       WHERE org_id = $1 AND title ILIKE $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [orgId, `%${search}%`, pageSize, (page - 1) * pageSize]
    );
    res.json({ meetings: result.rows, page, pageSize });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

router.post("/", async (req, res) => {
  const parsed = createMeetingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { orgId, userId } = req.auth!;
  const { title, meetingDate, transcriptText } = parsed.data;

  try {
    const result = await pool.query(
      `INSERT INTO meetings (org_id, title, meeting_date, transcript_text, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, title, meetingDate || null, transcriptText || null, userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create meeting" });
  }
});

router.get("/:id", async (req, res) => {
  const { orgId } = req.auth!;
  try {
    const result = await pool.query(
      "SELECT * FROM meetings WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch meeting" });
  }
});

// Trigger AI summary generation via the FastAPI microservice
router.post("/:id/summarize", async (req, res) => {
  const { orgId } = req.auth!;
  try {
    const meetingResult = await pool.query(
      "SELECT id, transcript_text FROM meetings WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId]
    );
    const meeting = meetingResult.rows[0];
    if (!meeting) return res.status(404).json({ error: "Not found" });
    if (!meeting.transcript_text) {
      return res.status(400).json({ error: "Meeting has no transcript to summarize" });
    }

    const aiResponse = await fetch(`${process.env.AI_SERVICE_URL}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: meeting.transcript_text }),
    });

    if (!aiResponse.ok) {
      return res.status(502).json({ error: "AI service failed to summarize" });
    }
    const { summary } = (await aiResponse.json()) as { summary: string };

    const updated = await pool.query(
      "UPDATE meetings SET summary = $1 WHERE id = $2 RETURNING *",
      [summary, req.params.id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to summarize meeting" });
  }
});

// Ask a question over a meeting's transcript via the AI service
const askSchema = z.object({
  question: z.string().min(1),
});

router.post("/:id/ask", async (req, res) => {
  const { orgId } = req.auth!;
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const meetingResult = await pool.query(
      "SELECT id, transcript_text FROM meetings WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId]
    );
    const meeting = meetingResult.rows[0];
    if (!meeting) return res.status(404).json({ error: "Not found" });

    const chunkCountResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM document_chunks WHERE meeting_id = $1",
      [req.params.id]
    );
    const hasIndexedDocuments = chunkCountResult.rows[0].count > 0;

    if (!meeting.transcript_text && !hasIndexedDocuments) {
      return res.status(400).json({
        error: "Meeting has no transcript or indexed documents to query",
      });
    }

    // meeting_id lets the AI service retrieve relevant chunks from any
    // documents uploaded to this meeting (retrieval-augmented generation),
    // in addition to whatever's in the transcript.
    const aiResponse = await fetch(`${process.env.AI_SERVICE_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: meeting.transcript_text || "",
        question: parsed.data.question,
        meeting_id: req.params.id,
      }),
    });

    if (!aiResponse.ok) {
      return res.status(502).json({ error: "AI service failed to answer" });
    }
    const { answer, sources } = (await aiResponse.json()) as {
      answer: string;
      sources?: string[];
    };
    res.json({ answer, sources: sources || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to answer question" });
  }
});

// Upload a document (transcript file, notes, recording, etc.) attached to a meeting
router.post("/:id/documents", upload.single("file"), async (req, res) => {
  const { orgId, userId } = req.auth!;
  try {
    const meetingResult = await pool.query(
      "SELECT id FROM meetings WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId]
    );
    if (meetingResult.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded (expected field 'file')" });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const extractable = isExtractable(req.file.mimetype);
    const result = await pool.query(
      `INSERT INTO documents (meeting_id, file_url, file_type, uploaded_by, ingestion_status)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, fileUrl, req.file.mimetype, userId, extractable ? "pending" : "skipped"]
    );
    const document = result.rows[0];
    res.status(201).json(document);

    // Fire off text extraction + embedding after responding, so a slow PDF
    // or a slow embedding model doesn't block the upload response. TXT/PDF/
    // DOCX only -- audio files (mp3/wav/m4a) are stored but not indexed for
    // Q&A since there's no transcription step in this pipeline yet.
    if (extractable) {
      extractText(req.file.path, req.file.mimetype)
        .then((text) => {
          if (!text) {
            return pool.query(
              "UPDATE documents SET ingestion_status = 'failed', ingestion_error = 'No extractable text found in file' WHERE id = $1",
              [document.id]
            );
          }
          return ingestDocument(document.id, req.params.id, text);
        })
        .catch((err) => {
          console.error("Text extraction failed", err);
          pool
            .query(
              "UPDATE documents SET ingestion_status = 'failed', ingestion_error = $1 WHERE id = $2",
              [err instanceof Error ? err.message : "Unknown extraction error", document.id]
            )
            .catch((updateErr) => console.error("Failed to record extraction error", updateErr));
        });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// List documents attached to a meeting
router.get("/:id/documents", async (req, res) => {
  const { orgId } = req.auth!;
  try {
    const meetingResult = await pool.query(
      "SELECT id FROM meetings WHERE id = $1 AND org_id = $2",
      [req.params.id, orgId]
    );
    if (meetingResult.rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }
    const result = await pool.query(
      "SELECT * FROM documents WHERE meeting_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json({ documents: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch documents" });
  }
});

// Org-wide analytics: meetings created per week, top contributors
// Restricted to owner/admin — members can see meetings but not org-wide analytics.
router.get("/analytics/summary", requireRole("owner", "admin"), async (req, res) => {
  const { orgId } = req.auth!;
  try {
    const perWeek = await pool.query(
      `SELECT date_trunc('week', created_at) AS week, COUNT(*)::int AS count
       FROM meetings
       WHERE org_id = $1
       GROUP BY week
       ORDER BY week DESC
       LIMIT 12`,
      [orgId]
    );

    const topContributors = await pool.query(
      `SELECT u.id AS user_id, u.email, COUNT(m.id)::int AS meeting_count
       FROM meetings m
       JOIN users u ON u.id = m.created_by
       WHERE m.org_id = $1
       GROUP BY u.id, u.email
       ORDER BY meeting_count DESC
       LIMIT 5`,
      [orgId]
    );

    const totals = await pool.query(
      `SELECT COUNT(*)::int AS total_meetings,
              COUNT(*) FILTER (WHERE summary IS NOT NULL)::int AS summarized_meetings
       FROM meetings WHERE org_id = $1`,
      [orgId]
    );

    res.json({
      meetingsPerWeek: perWeek.rows,
      topContributors: topContributors.rows,
      totals: totals.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute analytics" });
  }
});

export default router;
