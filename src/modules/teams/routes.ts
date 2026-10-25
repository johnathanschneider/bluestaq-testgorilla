import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { badRequest, notFound } from "../../errors";
import { parse } from "../../middleware/validate";
import type { TeamsRepository } from "./repository";

const createTeam = z.object({ name: z.string().trim().min(1).max(100) });
const addMember = z.object({ userId: z.string().min(1) });

export function teamsRouter(teams: TeamsRepository): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const { name } = parse(createTeam, req.body);
    const team = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    teams.create(team, req.userId);
    res.status(201).json(team);
  });

  router.get("/", (req, res) => {
    res.json({ items: teams.listForUser(req.userId) });
  });

  // Any existing member may add others: small teams, so no admin role (see README).
  router.post("/:teamId/members", (req, res) => {
    const teamId = String(req.params.teamId);
    // 404 for non-members too, so team ids can't be probed.
    if (!teams.teamExists(teamId) || !teams.isMember(teamId, req.userId)) throw notFound("Team");
    const { userId } = parse(addMember, req.body);
    if (!teams.userExists(userId)) throw badRequest("Unknown userId");
    teams.addMember(teamId, userId);
    res.status(204).end();
  });

  return router;
}
