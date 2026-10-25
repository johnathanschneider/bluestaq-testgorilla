import { Router, type RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dummyPasswordHash, verifyPassword } from "../../auth/password";
import { createSession, revokeSession } from "../../auth/sessions";
import type { Db } from "../../db/connection";
import { users } from "../../db/schema";
import { unauthorized } from "../../errors";
import { parse } from "../../middleware/validate";

const login = z.object({ username: z.string().trim().toLowerCase().min(1), password: z.string().min(1) });

export function authRouter(db: Db, requireUser: RequestHandler, ttlHours: number): Router {
  const router = Router();

  router.post("/login", async (req, res) => {
    const { username, password } = parse(login, req.body);
    const user = db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.username, username))
      .get();
    // Verify against a dummy hash for unknown users: same work, same error either way.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !ok) throw unauthorized("Invalid username or password");
    res.json(createSession(db, user.id, ttlHours));
  });

  router.post("/logout", requireUser, (req, res) => {
    revokeSession(db, req.token);
    res.status(204).end();
  });

  return router;
}
