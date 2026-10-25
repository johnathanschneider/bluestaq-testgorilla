import { Router } from "express";
import { parse } from "../../middleware/validate";
import { createNoteSchema, listNotesQuerySchema, updateNoteSchema } from "./schemas";
import type { notesService } from "./service";

export function notesRouter(service: ReturnType<typeof notesService>): Router {
  const router = Router();

  router.post("/", (req, res) => {
    res.status(201).json(service.create(req.userId, parse(createNoteSchema, req.body)));
  });

  router.get("/", (req, res) => {
    res.json(service.list(req.userId, parse(listNotesQuerySchema, req.query)));
  });

  router.get("/:id", (req, res) => {
    res.json(service.get(req.userId, String(req.params.id)));
  });

  router.patch("/:id", (req, res) => {
    res.json(service.update(req.userId, String(req.params.id), parse(updateNoteSchema, req.body)));
  });

  router.delete("/:id", (req, res) => {
    service.remove(req.userId, String(req.params.id));
    res.status(204).end();
  });

  return router;
}
