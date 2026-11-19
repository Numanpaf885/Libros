# Libros

A free, self-hostable reader for sharing course PDFs with a small group, privately, in the browser.

You upload a PDF once. Readers open it on any phone or computer with a personal code. There is nothing to install and no file to pass around. Every book has its own codes, and you decide per book whether readers can copy text or download it.

Live instance (used by a vocational avionics class in Barcelona): <https://librostmc0.vercel.app>. Access needs a code, and the interface is in Spanish (Spain).

## Why

Small classes, study groups and teachers often share material as PDFs in group chats. Those files get lost, get forwarded, and are hard to read on a phone. Hosted platforms cost money, need every reader to create an account, or take control of the files. Libros runs on free tiers (Vercel Hobby, a Google Sheet, Cloudflare R2), with no database server to run.

## Features

**Reader**
- Unlock a book with an access code or a shareable link (the code is removed from the address bar once it is used)
- Swipe and keyboard navigation, pinch or button zoom, continuous scroll, and a two-page book mode
- Chapters (taken from the PDF's own bookmarks), bookmarks, server-side search with highlights
- Selectable text layer laid out in reading order. Copying is allowed or blocked per book.
- Optional reader accounts: username + password, Face ID / fingerprint (passkeys), and reading progress synced across devices
- Light and dark mode. Works on screens 320 px wide and up.

**Admin panel (`/admin`)**
- Upload a PDF or a set of images. The PDF is turned into page images in the admin's own browser.
- Text extraction from the PDF, and OCR in the browser (tesseract.js, Spanish + English) for scanned pages
- Replace or delete books, create and revoke access codes, manage reader accounts
- PDF downloads with a download history. Downloaded PDFs carry the text as an invisible, searchable layer.
- Contact form inbox, legal pages, and a one-click database schema update (**Mantenimiento**)

**Engineering**
- Next.js 16 (App Router), React 19, strict TypeScript, Tailwind CSS v4
- Data in a Google Sheet. Page images in a private Cloudflare R2 bucket, served through short-lived signed URLs.
- Every outside call has a timeout and bounded retries. When Google or R2 is slow, pages show «Reintentar» (retry) instead of hanging.
- Access and activation codes are stored only as keyed hashes (HMAC-SHA-256). Admin passwords are hashed with bcrypt.
- No advertising or tracking cookies. A test fails if any cookie or storage key is missing from the public cookie table.
- A mock mode (`DATA_BACKEND=mock`) runs the whole app locally with no accounts
- 24 browser test scripts (Playwright) for layout, selection, search, downloads, OCR, focus and reduced-motion states, and resilience

## Try it locally (no accounts needed)

Requires Node.js 22.

```bash
git clone https://github.com/Numanpaf885/Libros.git
cd Libros
npm install
DATA_BACKEND=mock SESSION_SECRET=any-long-random-string-at-least-32-chars npm run dev
```

Open <http://localhost:3000/admin> and sign in as `admin` / `admin123`, upload a PDF, create a code, and open the book from the home page. Mock data is kept in `.data/`. Delete that folder to start over.

## Host your own

[SETUP.md](SETUP.md) walks through it step by step: a Google service account and Sheet, a private R2 bucket, environment variables (see [.env.example](.env.example)), and a deploy to Vercel. `npm run setup-sheet` creates the sheet's tabs for you.

## Tests

Start the mock server, install Playwright without saving it, then run the suites. [e2e/README.md](e2e/README.md) lists each script.

```bash
DATA_BACKEND=mock npx next dev -p 3100
npm i --no-save playwright-core
npm run e2e
```

## Content

Libros is software only. Whoever hosts an instance is responsible for having the right to share the files they upload.

## Contributing

Issues and pull requests are welcome. User-facing text is in Spanish (Spain). [CLAUDE.md](CLAUDE.md) holds the project's working rules (schema changes, timeouts, the cookie inventory). Libros is built by Numan Elahi Akhtar with the help of [Claude Code](https://claude.com/claude-code).

## License

[MIT](LICENSE) © 2026 Numan Elahi Akhtar
