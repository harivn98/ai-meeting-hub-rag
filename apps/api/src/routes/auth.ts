import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../config/db";

const router = Router();

function signToken(payload: { userId: string; orgId: string; role: string }) {
  const options: SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, process.env.JWT_SECRET as string, options);
}

const registerSchema = z.object({
  orgName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { orgName, email, password } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Email already registered" });
    }

    const orgResult = await client.query(
      "INSERT INTO organizations (name) VALUES ($1) RETURNING id",
      [orgName]
    );
    const orgId = orgResult.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      `INSERT INTO users (org_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner') RETURNING id, email, role, org_id`,
      [orgId, email, passwordHash]
    );

    await client.query("COMMIT");

    const user = userResult.rows[0];
    const token = signToken({ userId: user.id, orgId: user.org_id, role: user.role });

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, role: user.role, orgId: user.org_id },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  try {
    const result = await pool.query(
      "SELECT id, org_id, email, password_hash, role FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken({ userId: user.id, orgId: user.org_id, role: user.role });

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role, orgId: user.org_id },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
