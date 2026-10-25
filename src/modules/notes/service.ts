import { randomUUID } from "node:crypto";
import { badRequest, forbidden, notFound } from "../../errors";
import type { TeamsRepository } from "../teams/repository";
import type { Note, NotesRepository } from "./repository";
import type { CreateNoteInput, ListNotesQuery, UpdateNoteInput } from "./schemas";

export interface NotePage {
  items: Note[];
  nextCursor: string | null;
}

const encodeCursor = (n: Note) =>
  Buffer.from(JSON.stringify([n.updatedAt, n.id])).toString("base64url");

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof updatedAt === "string" && typeof id === "string") return { updatedAt, id };
  } catch {
    // fall through
  }
  throw badRequest("Invalid cursor");
}

/**
 * Turn free text into an FTS5 query that cannot raise syntax errors: each word is
 * quoted (so operators like AND/NEAR/- are literal) and the last gets a prefix match
 * so results appear while typing. Words are ANDed.
 */
function toMatchExpression(q: string): string {
  const words = q.split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => `"${w.replaceAll('"', '""')}"${i === words.length - 1 ? "*" : ""}`)
    .join(" ");
}

export function notesService(notes: NotesRepository, teams: TeamsRepository) {
  const canRead = (note: Note, userId: string) =>
    note.authorId === userId || (note.teamId !== null && teams.isMember(note.teamId, userId));

  /** Existence is hidden from users who can't read the note (404, not 403). */
  function readable(userId: string, id: string): Note {
    const note = notes.find(id);
    if (!note || !canRead(note, userId)) throw notFound("Note");
    return note;
  }

  function assertCanShareWith(userId: string, teamId: string | null) {
    if (teamId !== null && !teams.isMember(teamId, userId)) {
      throw forbidden("You can only share notes with teams you belong to");
    }
  }

  return {
    create(userId: string, input: CreateNoteInput): Note {
      assertCanShareWith(userId, input.teamId);
      const now = new Date().toISOString();
      const note: Note = { id: randomUUID(), authorId: userId, createdAt: now, updatedAt: now, ...input };
      notes.insert(note);
      return note;
    },

    get: readable,

    update(userId: string, id: string, input: UpdateNoteInput): Note {
      const note = readable(userId, id);
      // Any reader (i.e. team member) may edit content; moving a note between
      // private/teams is the author's call.
      if (input.teamId !== undefined && input.teamId !== note.teamId) {
        if (note.authorId !== userId) throw forbidden("Only the author can change sharing");
        assertCanShareWith(userId, input.teamId);
      }
      const updated: Note = { ...note, ...input, updatedAt: new Date().toISOString() };
      notes.save(updated);
      return updated;
    },

    remove(userId: string, id: string): void {
      const note = readable(userId, id);
      if (note.authorId !== userId) throw forbidden("Only the author can delete a note");
      notes.remove(id);
    },

    list(userId: string, query: ListNotesQuery): NotePage {
      // Fetch one extra row to learn whether another page exists.
      const rows = notes.list({
        userId,
        tag: query.tag,
        teamId: query.teamId,
        match: query.q ? toMatchExpression(query.q) : undefined,
        after: query.cursor ? decodeCursor(query.cursor) : undefined,
        limit: query.limit + 1,
      });
      const items = rows.slice(0, query.limit);
      const last = items.at(-1);
      return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null };
    },
  };
}
