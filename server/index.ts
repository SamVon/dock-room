import path from "node:path";
import next from "next";
import { DEFAULT_EVENTS } from "../config/events";
import { createApp } from "./app";
import { SqliteAdminStore, adminDatabasePath } from "./adminStore";
import { loadConfig, loadEnvFiles } from "./config";
import { FileEventRepository } from "./events";
import { jsonLogger } from "./logger";

async function main() {
  loadEnvFiles();
  const config = loadConfig();

  const web = next({ dev: !config.production, port: config.port });
  const handle = web.getRequestHandler();
  await web.prepare();

  const app = createApp(config, {
    log: jsonLogger,
    fallback: (req, res) => void handle(req, res),
    // Events changed on the admin page are saved here and survive a restart.
    eventRepository: new FileEventRepository(path.join(config.dataDir, "events.json"), DEFAULT_EVENTS, jsonLogger),
    // Admin accounts live in a database file, as password hashes. They are made with `npm run admin set <name>`.
    adminStore: new SqliteAdminStore(adminDatabasePath(config.dataDir)),
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void app.close();
      process.exit(0);
    });
  }

  app.httpServer.listen(config.port, () => {
    console.log(`> Duck Room ready on http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  // Configuration problems (missing APP_ORIGIN, SESSION_SECRET) stop the server with a clear message.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
