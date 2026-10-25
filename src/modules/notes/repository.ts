import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../db/connection";
import { noteTags, notes, teamMembers } from "../../db/schema";

export interface Note {
  id: string;
  authorId: string;
  teamId: string | null;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ListFilter {
  userId: string;
  tag?: string;
  teamId?: string;
  /** Already sanitized FTS5 MATCH expression. */
  match?: string;
  after?: { updatedAt: string; id: string };
  limit: number;
}

export function notesRepository(db: Db) {
  /** Attach tags (sorted) to note rows with one extra query. */
  function withTags(rows: Omit<Note, "tags">[]): Note[] {
    if (rows.length === 0) return [];
    const tagRows = db
      .select()
      .from(noteTags)
      .where(inArray(noteTags.noteId, rows.map((r) => r.id)))
      .all();
    const byNote = new Map<string, string[]>();
    for (const { noteId, tag } of tagRows) byNote.set(noteId, [...(byNote.get(noteId) ?? []), tag]);
    return rows.map((r) => ({ ...r, tags: (byNote.get(r.id) ?? []).sort() }));
  }

  return {
    insert(note: Note) {
      const { tags, ...row } = note;
      db.transaction((tx) => {
        tx.insert(notes).values(row).run();
        if (tags.length) tx.insert(noteTags).values(tags.map((tag) => ({ noteId: note.id, tag }))).run();
      });
    },

    /** Persists the full note state; tags are replaced wholesale. */
    save(note: Note) {
      const { tags, id, ...row } = note;
      db.transaction((tx) => {
        tx.update(notes).set(row).where(eq(notes.id, id)).run();
        tx.delete(noteTags).where(eq(noteTags.noteId, id)).run();
        if (tags.length) tx.insert(noteTags).values(tags.map((tag) => ({ noteId: id, tag }))).run();
      });
    },

    remove: (id: string) => void db.delete(notes).where(eq(notes.id, id)).run(),

    find(id: string): Note | undefined {
      const row = db.select().from(notes).where(eq(notes.id, id)).get();
      return row && withTags([row])[0];
    },

    /** Notes the user may read, newest-updated first, using keyset pagination. */
    list(f: ListFilter): Note[] {
      const conditions: (SQL | undefined)[] = [
        or(
          eq(notes.authorId, f.userId),
          inArray(
            notes.teamId,
            db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, f.userId)),
          ),
        ),
      ];
      if (f.match !== undefined) {
        // notes_fts is an FTS5 table outside the Drizzle schema, so this stays raw SQL.
        conditions.push(
          sql`${notes}.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ${f.match})`,
        );
      }
      if (f.teamId !== undefined) conditions.push(eq(notes.teamId, f.teamId));
      if (f.tag !== undefined) {
        conditions.push(
          exists(
            db
              .select({ one: noteTags.noteId })
              .from(noteTags)
              .where(and(eq(noteTags.noteId, notes.id), eq(noteTags.tag, f.tag))),
          ),
        );
      }
      if (f.after) {
        // Row-value comparison has no Drizzle helper.
        conditions.push(sql`(${notes.updatedAt}, ${notes.id}) < (${f.after.updatedAt}, ${f.after.id})`);
      }
      const rows = db
        .select()
        .from(notes)
        .where(and(...conditions))
        .orderBy(sql`${notes.updatedAt} DESC`, sql`${notes.id} DESC`)
        .limit(f.limit)
        .all();
      return withTags(rows);
    },
  };
}

export type NotesRepository = ReturnType<typeof notesRepository>;
