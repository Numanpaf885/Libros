// Usage: npm run hash-password
// Prompts for a password (hidden) and prints a bcrypt hash (cost 12) to paste into the `admins` tab.
import bcrypt from "bcryptjs";
import readline from "node:readline";

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once("line", (l) => { rl.close(); resolve(l); });
      return;
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n" || c === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(buf);
        }
        if (c === "\u0003") process.exit(130);
        if (c === "\u007f") buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

const pw = await ask("Password: ");
if (pw.length < 10) {
  console.error("Use at least 10 characters.");
  process.exit(1);
}
console.log(await bcrypt.hash(pw, 12));
