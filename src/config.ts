export const config = {
  port: Number(process.env.PORT ?? 3000),
  // ":memory:" is also valid, but data is then lost on restart.
  dbPath: process.env.DB_PATH ?? "notes.db",
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 24),
};
