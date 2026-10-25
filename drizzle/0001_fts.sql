-- Hand-written (drizzle-kit generate --custom): FTS5 is not expressible in the TS schema.
-- External-content index over notes, kept in sync by triggers.
CREATE VIRTUAL TABLE `notes_fts` USING fts5(
  title, body, content='notes', content_rowid='rowid'
);
--> statement-breakpoint
CREATE TRIGGER `notes_ai` AFTER INSERT ON `notes` BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_ad` AFTER DELETE ON `notes` BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER `notes_au` AFTER UPDATE ON `notes` BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
