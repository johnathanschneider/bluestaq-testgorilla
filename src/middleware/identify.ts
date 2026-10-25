import type { RequestHandler } from "express";
import type { Db } from "../db/connection";
import { findUserIdByToken } from "../auth/sessions";
import { unauthorized } from "../errors";

declare module "express-serve-static-core" {
  interface Request {
    userId: string;
    token: string;
  }
}

/**
 * Authenticates `Authorization: Bearer <token>` against the sessions table.
 * This is the only place that decides who the caller is; routes and services
 * only read `req.userId`.
 */
export function identify(db: Db): RequestHandler {
  return (req, _res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.header("authorization") ?? "");
    const userId = match?.[1] ? findUserIdByToken(db, match[1]) : undefined;
    if (!match?.[1] || !userId) throw unauthorized();
    req.userId = userId;
    req.token = match[1];
    next();
  };
}
