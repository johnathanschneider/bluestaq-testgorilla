import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { Db } from "../db/connection";
import { sessions } from "../db/schema";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(db: Db, userId: string, ttlHours: number) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();
  db.delete(sessions).where(lte(sessions.expiresAt, now.toISOString())).run(); // opportunistic purge
  db.insert(sessions)
    .values({ tokenHash: hashToken(token), userId, createdAt: now.toISOString(), expiresAt })
    .run();
  return { token, expiresAt };
}

/** Returns the user id for a live (unexpired) token, else undefined. */
export function findUserIdByToken(db: Db, token: string): string | undefined {
  const row = db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .get();
  return row?.userId;
}

export function revokeSession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}
