// Usage: npm run setup-sheet
// Brings the Google Sheet up to date with the app's schema (lib/sheet-schema.ts, shared with the admin's
// Mantenimiento → "Actualizar base de datos", which does exactly the same from the website): it creates any missing
// tab and any missing header name. It never reorders, renames or deletes anything and never touches data rows:
// missing headers (for example author, category and year on an older `books` tab) are only ever appended at the END
// of row 1. Running it again changes nothing.
// Reads GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID from .env.local / the environment.
import { google } from "googleapis";
import { googleSheetAdmin, updateSheet } from "../lib/sheet-schema.ts";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Put it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}

const auth = new google.auth.JWT({
  email: need("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: need("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const { changes, status } = await updateSheet(googleSheetAdmin(sheets, need("SHEET_ID")));
for (const t of status) {
  const made = changes.some((c) => c.kind === "tab" && c.tab === t.tab);
  const added = changes.flatMap((c) => (c.kind === "column" && c.tab === t.tab ? [c.column] : []));
  console.log(made ? `created tab: ${t.tab}` : `tab exists: ${t.tab}`);
  if (added.length) console.log(`  added header${added.length > 1 ? "s" : ""} to ${t.tab}: ${added.join(", ")}`);
  if (t.misplaced.length) console.log(`  note: ${t.tab} has ${t.misplaced.join(", ")} in another order (fine: the app finds columns by their name)`);
}
if (!changes.length) console.log("Everything was already up to date.");
console.log("Done. Add your admin row to the `admins` tab: username | bcrypt hash (npm run hash-password).");
