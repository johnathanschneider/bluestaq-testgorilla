import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

// Same relative path from src/db (tsx, vitest) and dist/db (compiled).
const migrationsFolder = path.join(__dirname, "../../drizzle");

export function openDb(file: string) {
  const client = new Database(file);
  client.pragma("journal_mode = WAL");
  client.pragma("foreign_keys = ON");
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

export type Db = ReturnType<typeof openDb>;
