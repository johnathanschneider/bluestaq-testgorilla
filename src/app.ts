import express from "express";
import { config } from "./config";
import type { Db } from "./db/connection";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { identify } from "./middleware/identify";
import { authRouter } from "./modules/auth/routes";
import { notesRouter } from "./modules/notes/routes";
import { notesRepository } from "./modules/notes/repository";
import { notesService } from "./modules/notes/service";
import { teamsRepository } from "./modules/teams/repository";
import { teamsRouter } from "./modules/teams/routes";
import { usersRouter } from "./modules/users/routes";

/** Builds the app around an already-open database so tests can use ":memory:". */
export function createApp(db: Db, opts: { sessionTtlHours?: number } = {}) {
  const teams = teamsRepository(db);
  const notes = notesService(notesRepository(db), teams);
  const requireUser = identify(db);

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_req, res) => void res.json({ status: "ok" }));

  const api = express.Router();
  api.use("/users", usersRouter(db));
  api.use("/auth", authRouter(db, requireUser, opts.sessionTtlHours ?? config.sessionTtlHours));
  api.use("/teams", requireUser, teamsRouter(teams));
  api.use("/notes", requireUser, notesRouter(notes));
  app.use("/api/v1", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
