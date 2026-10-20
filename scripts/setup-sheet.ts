// Usage: npm run setup-sheet
// Creates any missing tabs (`books`, `access_codes`, `admins`, `users`, `user_books`, `progress`, `passkeys`, `bookmarks`, `downloads`) and any missing header names.
// It never reorders existing columns and never touches data rows: missing headers (for example
// author, category and year on an older `books` tab) are only ever appended at the END of row 1.
// Reads GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID from .env.local / the environment.
import { google } from "googleapis";

const TABS: Record<string, string[]> = {
  books: ["id", "slug", "title", "description", "page_count", "storage_prefix", "cover_path", "status", "updated_at", "author", "category", "year", "page_labels", "original_pdf_size", "original_pdf_pages"],
  access_codes: ["id", "book_id", "code_hash", "label", "created_at", "expires_at", "revoked"],
  admins: ["username", "password_hash"],
  // Reader accounts (added later; the tabs above are never modified).
  // can_download (appended at the END, later) is the per-user "may download PDF" switch.
  users: ["id", "username", "display_name", "password_hash", "status", "setup_code_hash", "setup_code_expires_at", "setup_attempts", "failed_logins", "locked_until", "session_version", "created_at", "last_login_at", "can_download"],
  user_books: ["user_id", "book_id", "source", "code_id", "granted_at"],
  progress: ["user_id", "book_id", "page", "updated_at"],
  passkeys: ["id", "user_id", "credential_id", "public_key", "counter", "transports", "label", "created_at", "last_used_at"],
  // Bookmarks ("Marcadores")
  bookmarks: ["id", "user_id", "book_id", "page", "label", "created_at"],
  // Download log (snapshots of user / book names, so it stays readable after renames and deletions)
  downloads: ["id", "actor", "user_id", "username", "display_name", "book_id", "book_title", "from_page", "to_page", "page_count", "device", "status", "created_at", "finished_at", "method"],
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Put it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}
/** 1 -> A, 27 -> AA */
function col(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const auth = new google.auth.JWT({
  email: need("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  key: need("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = need("SHEET_ID");

const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
const have = new Set(meta.data.sheets?.map((s) => s.properties?.title));

for (const [tab, headers] of Object.entries(TABS)) {
  if (!have.has(tab)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
    console.log(`created tab: ${tab}`);
  } else {
    console.log(`tab exists: ${tab}`);
  }
  const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!1:1` });
  const current = (head.data.values?.[0] ?? []).map((c) => String(c ?? "").trim());
  const missing = headers.filter((h) => !current.includes(h));
  if (!missing.length) continue;
  // Write only the missing names, starting right after the last existing header.
  const from = current.length + 1;
  const range = `${tab}!${col(from)}1:${col(from + missing.length - 1)}1`;
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: "RAW", requestBody: { values: [missing] } });
  console.log(`  added header${missing.length > 1 ? "s" : ""} to ${tab}: ${missing.join(", ")}`);
}
console.log("Done. Add your admin row to the `admins` tab: username | bcrypt hash (npm run hash-password).");
