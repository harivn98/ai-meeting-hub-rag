def chunk_text(text: str, chunk_size: int = 220, overlap: int = 40) -> list[str]:
    """Split text into overlapping, word-based chunks.

    A simple word-count chunker is good enough here: embeddings models are
    fairly tolerant of chunk boundaries, and this avoids pulling in a
    tokenizer dependency just to size chunks roughly right for retrieval.

    chunk_size/overlap are in words. ~220 words is roughly a paragraph or
    two — small enough to keep retrieval precise, large enough to keep
    context coherent.
    """
    words = text.split()
    if not words:
        return []

    if chunk_size <= overlap:
        raise ValueError("chunk_size must be greater than overlap")

    chunks: list[str] = []
    start = 0
    step = chunk_size - overlap
    while start < len(words):
        piece = words[start : start + chunk_size]
        chunk = " ".join(piece).strip()
        if chunk:
            chunks.append(chunk)
        if start + chunk_size >= len(words):
            break
        start += step

    return chunks
