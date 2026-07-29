import os

import asyncpg
from pgvector.asyncpg import register_vector

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub",
)

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Teaches asyncpg how to encode/decode the `vector` column type so we can
    # pass/receive plain Python lists of floats instead of hand-rolling SQL
    # string literals like '[0.1,0.2,...]'::vector.
    await register_vector(conn)


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=1,
            max_size=5,
            init=_init_connection,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
