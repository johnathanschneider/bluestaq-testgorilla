import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { hashPassword } from "../../auth/password";
import type { Db } from "../../db/connection";
import { users } from "../../db/schema";
import { conflict } from "../../errors";
import { parse } from "../../middleware/validate";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,32}$/, "3-32 characters: letters, digits, underscore");

const createUser = z.object({
  username: usernameSchema,
  // 72 is bcrypt's limit; kept as a sane upper bound even though scrypt has none.
  password: z.string().min(8).max(72),
  name: z.string().trim().min(1).max(100),
});

/** Unauthenticated: registration. Callers then log in via POST /auth/login. */
export function usersRouter(db: Db): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const { username, password, name } = parse(createUser, req.body);
    const user = { id: randomUUID(), username, name, createdAt: new Date().toISOString() };
    const passwordHash = await hashPassword(password);
    try {
      db.insert(users).values({ ...user, passwordHash }).run();
    } catch (err) {
      // Rely on the unique index instead of check-then-insert, which would race.
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        throw conflict("Username already taken");
      }
      throw err;
    }
    res.status(201).json(user);
  });

  return router;
}
