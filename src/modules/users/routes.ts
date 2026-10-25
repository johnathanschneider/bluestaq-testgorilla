import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../db/connection";
import { users } from "../../db/schema";
import { parse } from "../../middleware/validate";

const createUser = z.object({ name: z.string().trim().min(1).max(100) });

/** Unauthenticated: this is how callers obtain an id to send as X-User-Id. */
export function usersRouter(db: Db): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const { name } = parse(createUser, req.body);
    const user = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    db.insert(users).values(user).run();
    res.status(201).json(user);
  });

  return router;
}
