import type { RequestHandler } from "express";
import type { Db } from "../db/connection";
import { unauthorized } from "../errors";

declare module "express-serve-static-core" {
  interface Request {
    userId: string;
  }
}

/**
 * STUB AUTHENTICATION: trusts the X-User-Id header after checking the user exists.
 * This is the only place that decides who the caller is, so replacing it with
 * token/JWT verification does not touch any route or service.
 */
export function identify(db: Db): RequestHandler {
  const find = db.prepare("SELECT id FROM users WHERE id = ?");
  return (req, _res, next) => {
    const id = req.header("x-user-id");
    if (!id || !find.get(id)) throw unauthorized();
    req.userId = id;
    next();
  };
}
