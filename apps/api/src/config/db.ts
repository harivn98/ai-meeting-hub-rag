import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err: Error) => {
  console.error("Unexpected error on idle Postgres client", err);
});
