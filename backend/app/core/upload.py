"""Bounded file upload helpers to prevent OOM from oversized requests."""

from fastapi import HTTPException, UploadFile

# Align with frontend nginx client_max_body_size
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
CHUNK_SIZE = 64 * 1024  # 64 KB


async def read_upload_bounded(
    file: UploadFile,
    max_bytes: int = MAX_UPLOAD_BYTES,
) -> bytes:
    """
    Read upload file in chunks with size limit. Stops reading and raises
    HTTPException if total size exceeds max_bytes, avoiding OOM from huge uploads.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File too large (max {max_bytes // (1024 * 1024)}MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)
