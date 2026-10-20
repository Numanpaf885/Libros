# Libros (book-reader) — notes for Claude

Read `AGENTS.md` first: this Next.js (16.x) has breaking changes, so check `node_modules/next/dist/docs/` before writing framework code.

## What it is
A private book reader. Live: https://librostmc0.vercel.app (Vercel Hobby, auto-deploys from `main` of GitHub `Numanpaf885/Libros`). Real users, so keep API inputs/outputs, cookie names and formats, sheet tabs and columns, storage keys and env var names stable.

## Stack
Next.js App Router, React 19, TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), Tailwind v4. Data in a Google Sheet (`lib/db/sheets.ts`), page images in a private Cloudflare R2 bucket (`lib/storage/r2.ts`). `DATA_BACKEND=mock` swaps both for in-memory/`.data/` versions; it is refused in production (`lib/safety.ts`).

## Rules
- `lib/db/*` and `lib/storage/*` start with `import "server-only"`: never import them from a client component.
- `pdfjs-dist` is loaded with a dynamic `import()` only in `lib/client/render-pdf.ts` (admin upload/replace).
- Texts for users are Spanish (Spain), addressed as "tú".
- Never print or commit values from `.env.local`. Do not delete `.env.local`, `.data/` or `screenshots/`.
- One button system (`.btn*` in `app/globals.css`), one modal/sheet (`components/ui`), one icon set (`components/ui/Icon`).

## Commands
- `npm run dev` / `npm run build` / `npm run lint`
- Mock mode: `DATA_BACKEND=mock SESSION_SECRET=<32+ chars> npm run dev` (admin `admin` / `admin123`).
- Browser tests: `npm i --no-save playwright-core`, then `npm run e2e` against a mock dev server (see `e2e/README.md`).
- `npm run setup-sheet`, `npm run hash-password`: see `SETUP.md`.
