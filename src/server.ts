import { createApp } from "./app";
import { config } from "./config";
import { openDb } from "./db/connection";

const db = openDb(config.dbPath);
const server = createApp(db).listen(config.port, () => {
  console.log(`Notes API listening on http://localhost:${config.port} (db: ${config.dbPath})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
