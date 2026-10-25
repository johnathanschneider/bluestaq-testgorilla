import type { Db } from "../../db/connection";

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

interface NoteRow extends Omit<Note, "tags"> {
  tags: string;
}

const SELECT = `
  SELECT n.id, n.author_id AS authorId, n.team_id AS teamId, n.title, n.body,
         n.created_at AS createdAt, n.updated_at AS updatedAt,
         (SELECT json_group_array(tag) FROM
            (SELECT tag FROM note_tags WHERE note_id = n.id ORDER BY tag)) AS tags
  FROM notes n`;

const toNote = (row: NoteRow): Note => ({ ...row, tags: JSON.parse(row.tags) });

export function notesRepository(db: Db) {
  const insertNote = db.prepare(
    `INSERT INTO notes (id, author_id, team_id, title, body, created_at, updated_at)
     VALUES (@id, @authorId, @teamId, @title, @body, @createdAt, @updatedAt)`,
  );
  const updateNote = db.prepare(
    `UPDATE notes SET team_id = @teamId, title = @title, body = @body, updated_at = @updatedAt
     WHERE id = @id`,
  );
  const deleteNote = db.prepare("DELETE FROM notes WHERE id = ?");
  const insertTag = db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)");
  const deleteTags = db.prepare("DELETE FROM note_tags WHERE note_id = ?");
  const byId = db.prepare(`${SELECT} WHERE n.id = ?`);

  const replaceTags = (noteId: string, tags: string[]) => {
    deleteTags.run(noteId);
    for (const t of tags) insertTag.run(noteId, t);
  };

  return {
    insert: db.transaction((note: Note) => {
      insertNote.run(note);
      replaceTags(note.id, note.tags);
    }),

    /** Persists the full note state; tags are replaced wholesale. */
    save: db.transaction((note: Note) => {
      updateNote.run(note);
      replaceTags(note.id, note.tags);
    }),

    remove: (id: string) => void deleteNote.run(id),

    find(id: string): Note | undefined {
      const row = byId.get(id) as NoteRow | undefined;
      return row && toNote(row);
    },

    /** Notes the user may read, newest-updated first, using keyset pagination. */
    list(f: ListFilter): Note[] {
      const params: Record<string, unknown> = { userId: f.userId, limit: f.limit };
      const where = [
        `(n.author_id = @userId OR n.team_id IN
           (SELECT team_id FROM team_members WHERE user_id = @userId))`,
      ];
      let join = "";
      if (f.match !== undefined) {
        join = "JOIN notes_fts ON notes_fts.rowid = n.rowid";
        where.push("notes_fts MATCH @match");
        params.match = f.match;
      }
      if (f.teamId !== undefined) {
        where.push("n.team_id = @teamId");
        params.teamId = f.teamId;
      }
      if (f.tag !== undefined) {
        where.push("EXISTS (SELECT 1 FROM note_tags t WHERE t.note_id = n.id AND t.tag = @tag)");
        params.tag = f.tag;
      }
      if (f.after) {
        where.push("(n.updated_at, n.id) < (@afterUpdated, @afterId)");
        params.afterUpdated = f.after.updatedAt;
        params.afterId = f.after.id;
      }
      const sql = `${SELECT} ${join} WHERE ${where.join(" AND ")}
                   ORDER BY n.updated_at DESC, n.id DESC LIMIT @limit`;
      return (db.prepare(sql).all(params) as NoteRow[]).map(toNote);
    },
  };
}

export type NotesRepository = ReturnType<typeof notesRepository>;
