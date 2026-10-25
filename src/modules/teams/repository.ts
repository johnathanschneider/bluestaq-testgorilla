import type { Db } from "../../db/connection";

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

export function teamsRepository(db: Db) {
  const insertTeam = db.prepare("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)");
  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)",
  );
  const memberStmt = db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?");
  const teamExists = db.prepare("SELECT 1 FROM teams WHERE id = ?");
  const userExists = db.prepare("SELECT 1 FROM users WHERE id = ?");
  const forUser = db.prepare(
    `SELECT t.id, t.name, t.created_at AS createdAt FROM teams t
     JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY t.name`,
  );

  return {
    /** Creates the team and enrolls its creator atomically. */
    create: db.transaction((team: Team, creatorId: string) => {
      insertTeam.run(team.id, team.name, team.createdAt);
      insertMember.run(team.id, creatorId);
    }),
    addMember: (teamId: string, userId: string) => void insertMember.run(teamId, userId),
    isMember: (teamId: string, userId: string) => memberStmt.get(teamId, userId) !== undefined,
    teamExists: (teamId: string) => teamExists.get(teamId) !== undefined,
    userExists: (userId: string) => userExists.get(userId) !== undefined,
    listForUser: (userId: string) => forUser.all(userId) as Team[],
  };
}

export type TeamsRepository = ReturnType<typeof teamsRepository>;
