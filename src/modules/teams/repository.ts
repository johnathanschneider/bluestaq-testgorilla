import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../../db/connection";
import { teamMembers, teams, users } from "../../db/schema";

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

export function teamsRepository(db: Db) {
  const addMember = (teamId: string, userId: string) =>
    void db.insert(teamMembers).values({ teamId, userId }).onConflictDoNothing().run();

  return {
    /** Creates the team and enrolls its creator atomically. */
    create(team: Team, creatorId: string) {
      db.transaction((tx) => {
        tx.insert(teams).values(team).run();
        tx.insert(teamMembers).values({ teamId: team.id, userId: creatorId }).run();
      });
    },
    addMember,
    isMember: (teamId: string, userId: string) =>
      db
        .select({ one: teamMembers.teamId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
        .get() !== undefined,
    teamExists: (teamId: string) =>
      db.select({ one: teams.id }).from(teams).where(eq(teams.id, teamId)).get() !== undefined,
    userExists: (userId: string) =>
      db.select({ one: users.id }).from(users).where(eq(users.id, userId)).get() !== undefined,
    listForUser: (userId: string): Team[] =>
      db
        .select({ id: teams.id, name: teams.name, createdAt: teams.createdAt })
        .from(teams)
        .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .where(eq(teamMembers.userId, userId))
        .orderBy(asc(teams.name))
        .all(),
  };
}

export type TeamsRepository = ReturnType<typeof teamsRepository>;
