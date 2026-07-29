import os
from contextlib import asynccontextmanager
from typing import Optional
from uuid import UUID

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .chunking import chunk_text
from .db import close_pool, get_pool

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
# Dedicated embedding model. Pull it once with: `ollama pull nomic-embed-text`
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# How many of the most relevant chunks to pull back per question.
RETRIEVAL_TOP_K = int(os.getenv("RAG_TOP_K", "5"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the DB pool on startup so the first ingest/ask isn't slow, and
    # close it cleanly on shutdown.
    await get_pool()
    yield
    await close_pool()


app = FastAPI(title="AI Meeting Hub - AI Service", lifespan=lifespan)


class SummarizeRequest(BaseModel):
    transcript: str


class SummarizeResponse(BaseModel):
    summary: str


class AskRequest(BaseModel):
    transcript: str
    question: str
    # When set, retrieval-augmented generation kicks in: the question is
    # embedded and matched against that meeting's indexed document chunks.
    meeting_id: Optional[UUID] = None


class AskResponse(BaseModel):
    answer: str
    sources: list[str] = []


class IngestRequest(BaseModel):
    document_id: UUID
    meeting_id: UUID
    text: str


class IngestResponse(BaseModel):
    document_id: UUID
    chunks_created: int


async def call_ollama_generate(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Ollama request failed: {exc}")

    data = resp.json()
    return data.get("response", "").strip()


async def call_ollama_embed(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/embeddings",
                json={"model": OLLAMA_EMBED_MODEL, "prompt": text},
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail=f"Ollama embedding request failed: {exc}"
            )

    data = resp.json()
    embedding = data.get("embedding")
    if not embedding:
        raise HTTPException(status_code=502, detail="Ollama returned no embedding")
    return embedding


@app.get("/health")
async def health():
    return {"status": "ok", "model": OLLAMA_MODEL, "embed_model": OLLAMA_EMBED_MODEL}


@app.post("/summarize", response_model=SummarizeResponse)
async def summarize(req: SummarizeRequest):
    prompt = (
        "You are an assistant that writes concise, structured meeting summaries.\n"
        "Summarize the following meeting transcript into:\n"
        "1. Key discussion points\n2. Decisions made\n3. Action items (with owner if mentioned)\n\n"
        f"Transcript:\n{req.transcript}\n\nSummary:"
    )
    summary = await call_ollama_generate(prompt)
    return SummarizeResponse(summary=summary)


@app.post("/documents/ingest", response_model=IngestResponse)
async def ingest_document(req: IngestRequest):
    """Chunk + embed a document's extracted text and store it in pgvector.

    Called by the API service right after a document upload has had its
    text extracted (TXT/PDF/DOCX). Safe to call multiple times for the same
    document_id -- old chunks are replaced.
    """
    chunks = chunk_text(req.text)
    if not chunks:
        return IngestResponse(document_id=req.document_id, chunks_created=0)

    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Re-ingesting (e.g. retry after a failure) shouldn't duplicate chunks.
            await conn.execute(
                "DELETE FROM document_chunks WHERE document_id = $1", req.document_id
            )

            for index, chunk in enumerate(chunks):
                embedding = await call_ollama_embed(chunk)
                await conn.execute(
                    """
                    INSERT INTO document_chunks
                        (document_id, meeting_id, chunk_index, content, embedding)
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    req.document_id,
                    req.meeting_id,
                    index,
                    chunk,
                    embedding,
                )

    return IngestResponse(document_id=req.document_id, chunks_created=len(chunks))


async def retrieve_chunks(meeting_id: UUID, question: str, top_k: int) -> list[str]:
    question_embedding = await call_ollama_embed(question)
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT content
            FROM document_chunks
            WHERE meeting_id = $1
            ORDER BY embedding <=> $2
            LIMIT $3
            """,
            meeting_id,
            question_embedding,
            top_k,
        )
    return [row["content"] for row in rows]


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest):
    sources: list[str] = []
    if req.meeting_id is not None:
        sources = await retrieve_chunks(req.meeting_id, req.question, RETRIEVAL_TOP_K)

    if sources:
        retrieved_block = "\n\n".join(
            f"[Excerpt {i + 1}]\n{chunk}" for i, chunk in enumerate(sources)
        )
        prompt = (
            "Answer the question using the meeting transcript and the retrieved "
            "document excerpts below. If the answer isn't in either, say so.\n\n"
            f"Transcript:\n{req.transcript}\n\n"
            f"Retrieved document excerpts:\n{retrieved_block}\n\n"
            f"Question: {req.question}\nAnswer:"
        )
    else:
        prompt = (
            "Answer the question using only information from the transcript below. "
            "If the answer isn't in the transcript, say so.\n\n"
            f"Transcript:\n{req.transcript}\n\nQuestion: {req.question}\nAnswer:"
        )

    answer = await call_ollama_generate(prompt)
    return AskResponse(answer=answer, sources=sources)
