# Libros (book-reader) — notes for Claude

Read `AGENTS.md` first: this Next.js (16.x) has breaking changes, so check `node_modules/next/dist/docs/` before writing framework code.

## What it is
A private book reader. Live: https://librostmc0.vercel.app (Vercel Hobby, auto-deploys from `main` of GitHub `Numanpaf885/Libros`). Real users, so keep API inputs/outputs, cookie names and formats, sheet tabs and columns, storage keys and env var names stable.

## Stack
Next.js App Router, React 19, TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), Tailwind v4. Data in a Google Sheet (`lib/db/sheets.ts`), page images in a private Cloudflare R2 bucket (`lib/storage/r2.ts`). `DATA_BACKEND=mock` swaps both for in-memory/`.data/` versions; it is refused in production (`lib/safety.ts`).

## Rules
- `lib/db/*` and `lib/storage/*` start with `import "server-only"`: never import them from a client component.
- `pdfjs-dist` (its legacy build) is loaded with a dynamic `import()` only in `lib/client/render-pdf.ts` (admin upload/replace/"Extraer texto"). `tesseract.js` is loaded only in `lib/client/ocr.ts` (admin OCR); its files are self-hosted in `public/ocr/` (copied from node_modules by `scripts/copy-ocr-assets.mjs`). The reader bundle must contain neither: check with `node e2e/bundle-size.mjs` after `npm run build`.
- Texts for users are Spanish (Spain), addressed as "tú".
- New tabs or columns: add them ONLY to the shared schema in `lib/sheet-schema.ts` (a new tab in `TABS`, a new column at the END of its tab's `EXTRA_COLS`, never in the middle or renamed). `npm run setup-sheet` and /admin → Mantenimiento → «Actualizar base de datos» both apply it; the code must keep working (feature hidden) until the column or tab exists.
- Never print or commit values from `.env.local`. Do not delete `.env.local`, `.data/` or `screenshots/`.
- One button system (`.btn*` in `app/globals.css`), one modal/sheet (`components/ui`), one icon set (`components/ui/Icon`).
- Every new cookie, localStorage/sessionStorage key or IndexedDB database must be added to `lib/cookie-inventory.ts` (the table on /cookies; `e2e/legal.mjs` fails on anything not listed). Only "Técnica necesaria" or "Preferencia" items are allowed as they are. Before any non-essential cookie or storage (analytics, advertising, third-party embeds) is added, a real consent banner with "Rechazar" (as easy as "Aceptar") must come first and nothing may be set before consent.
- `/privacidad` describes what the code does: if you start storing a new personal datum, sending data to a new provider or keeping it longer, update that page in the same change.
- No page may hang on an outside service. Google Sheets is only reached through `lib/db/sheets.ts` (`call()`: 8 s budget, bounded backoff on 429/5xx, googleapis' own retries off, a short pause after a failure) and R2 only through `lib/storage/r2.ts` (`timed()`: 5 s). Any new outside call gets a timeout too, and so does every client `fetch` (`request()` in `lib/client/api.ts`).
- Never ask Google for a tab without knowing it exists: one missing range fails a whole batchGet with 400. `Table.listMany` reads only existing tabs; a missing optional tab is absent from the result, and its feature says «Actualiza la base de datos en Mantenimiento» in the admin only.
- Columns are found by header NAME. `Table` rows are in `lib/sheet-schema.ts` order whatever the order in the sheet; unknown columns are ignored on read and kept on write.
- "Google did not answer" is not "signed out", "locked" or "no data". Rethrow `isUnavailable(e)` errors (`lib/db/errors.ts`). API routes turn them into a 503 via `safe()`; pages use `softly()` (`lib/soft.ts`) to render with what they have, or fall to `app/error.tsx`. Both show «Reintentar», never an endless spinner.
- Pages that must never wait (legal pages, footer) read settings with `getLegal()` (cache or empty).
- After changing data access, run `e2e/resilience.mjs` (the real adapter against the fake Google API).

## Commands
- `npm run dev` / `npm run build` / `npm run lint`
- Mock mode: `DATA_BACKEND=mock SESSION_SECRET=<32+ chars> npm run dev` (admin `admin` / `admin123`).
- Browser tests: `npm i --no-save playwright-core`, then `npm run e2e` against a mock dev server (see `e2e/README.md`).
- `npm run setup-sheet`, `npm run hash-password`: see `SETUP.md`.
