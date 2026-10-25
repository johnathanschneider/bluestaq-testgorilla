import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, notFound } from "../errors";

export const notFoundHandler: RequestHandler = () => {
  throw notFound("Route");
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  // Malformed JSON bodies surface from express.json() as SyntaxError with status 400.
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "bad_request", message: "Invalid JSON body" } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
};
