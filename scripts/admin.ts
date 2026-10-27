// Manage admin accounts on the server:
//   npm run admin set <name>      create the account, or change its password (asks for the password)
//   npm run admin list
//   npm run admin remove <name>
// The password is typed here, hidden, and only its hash is saved in DATA_DIR/duck-room.db.
import { loadEnvFiles } from "../server/config";
import { ADMIN_PASSWORD_MIN, SqliteAdminStore, adminDatabasePath } from "../server/adminStore";

/** Reads one line without showing it. When the input is piped, reads the pipe instead. */
function readHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => (data += chunk));
      stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")));
    });
  }
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let typed = "";
    const done = (finish: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      finish();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return done(() => resolve(typed));
        if (char === "\u0003") return done(() => reject(new Error("Cancelled"))); // Ctrl+C
        if (char === "\u007f" || char === "\b") typed = typed.slice(0, -1);
        else typed += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  loadEnvFiles();
  const [command, name] = process.argv.slice(2);
  const file = adminDatabasePath(process.env.DATA_DIR || "data");
  const store = new SqliteAdminStore(file);

  if (command === "list") {
    const accounts = store.list();
    if (!accounts.length) console.log("No admin accounts yet. Make one with: npm run admin set <name>");
    for (const account of accounts) console.log(`${account.username}  (password set ${new Date(account.updatedAt).toISOString().slice(0, 10)})`);
  } else if (command === "set" && name) {
    const password = await readHidden(`New password for ${name} (${ADMIN_PASSWORD_MIN}+ characters, not shown): `);
    if (process.stdin.isTTY && (await readHidden("Type it again: ")) !== password) throw new Error("The two passwords are not the same");
    const account = store.setPassword(name, password);
    console.log(`Saved admin "${account.username}" in ${file}. The server uses it at once; no restart needed.`);
  } else if (command === "remove" && name) {
    console.log(store.remove(name) ? `Removed admin "${name}".` : `There is no admin "${name}".`);
  } else {
    console.log("Usage:\n  npm run admin set <name>\n  npm run admin list\n  npm run admin remove <name>");
    process.exitCode = 1;
  }
  store.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
