// Shares the Duck Room on this computer with friends, through a Cloudflare quick tunnel.
//
//   npm run share
//
// It builds the app, opens a tunnel (no Cloudflare account needed), and starts the server in
// production mode with the tunnel's address as the only allowed origin. Press Ctrl+C to stop;
// the link stops working at once. The address is new every time you run it.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(String(port)));
    });
  });

// Its own build folder, and a lock so only one shared copy runs at a time.
// A second run would rebuild that folder and break the first one's pages.
const DIST_DIR = ".next-share";
const LOCK_FILE = ".share.lock";

const isRunning = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (existsSync(LOCK_FILE) && isRunning(Number(readFileSync(LOCK_FILE, "utf8")))) {
  console.error("Duck Room is already being shared from another terminal.");
  console.error("Use the link shown there, or press Ctrl+C in that terminal first.");
  process.exit(1);
}
writeFileSync(LOCK_FILE, String(process.pid));

const children = [];
const stop = (code = 0) => {
  for (const child of children) child.kill();
  rmSync(LOCK_FILE, { force: true });
  process.exit(code);
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

if (spawnSync("cloudflared", ["--version"]).error) {
  console.error("cloudflared is not installed. Install it first:  brew install cloudflared");
  stop(1);
}

console.log("Building Duck Room...");
const buildEnv = { ...process.env, NEXT_DIST_DIR: DIST_DIR };
if (spawnSync("npm", ["run", "build"], { stdio: ["ignore", "ignore", "inherit"], env: buildEnv }).status !== 0) stop(1);

const port = process.env.PORT || (await freePort());

console.log("Opening the tunnel...");
const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"], {
  stdio: ["ignore", "ignore", "pipe"],
});
children.push(tunnel);
tunnel.on("exit", () => {
  console.error("The tunnel closed.");
  stop(1);
});

// cloudflared prints the public address in its log once the tunnel is up.
const origin = await new Promise((resolve) => {
  let log = "";
  tunnel.stderr.on("data", (chunk) => {
    log += chunk;
    const found = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (found) resolve(found[0]);
  });
});

const server = spawn("npx", ["tsx", "server/index.ts"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    NEXT_DIST_DIR: DIST_DIR,
    PORT: port,
    APP_ORIGIN: origin, // only pages from the tunnel address may talk to the server
    SESSION_SECRET: randomBytes(48).toString("base64url"), // new every run, never stored
    TRUST_PROXY: "true", // rate limits use each friend's real address, sent by Cloudflare
  },
});
children.push(server);
server.on("exit", (code) => stop(code ?? 1));

server.stdout.on("data", (chunk) => {
  if (!String(chunk).includes("Duck Room ready")) return;
  console.log(`
  Duck Room is live. Send this link to your friends:

      ${origin}

  Open the same link yourself (not localhost), then create a room and share the room link.
  The address can take a few seconds to start working. Press Ctrl+C to stop sharing.
`);
});
