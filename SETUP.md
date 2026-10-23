# Setup guide (Libros)

Written for a Chromebook: run every command in the **Linux terminal** (Settings → Advanced → Developers → Linux development environment). You need Node.js 22.18 or newer (`node -v`); if it is missing, install it with [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`).

This app has two halves: a **reader** (`/b/<book>`) where people type an access code, and an **admin panel** (`/admin`) where you manage books and codes. Your data lives in a Google Sheet; page images live in a private Cloudflare R2 bucket. The original PDF is never stored anywhere — it is turned into page images in *your browser* when you upload.

## 0. Try it locally first (no accounts needed)

```bash
cd book-reader
npm install
DATA_BACKEND=mock SESSION_SECRET=any-long-random-string-at-least-32-chars npm run dev
```

Open <http://localhost:3000/admin>. Mock mode seeds one admin: username `admin`, password `admin123` (change with `MOCK_ADMIN_PASSWORD`). Data is kept under `.data/`; delete that folder to reset.

## 1. Google Cloud: service account + Sheets API

1. Go to <https://console.cloud.google.com> and create a project (or pick one).
2. **APIs & Services → Library** → search **Google Sheets API** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → Service account**. Give it any name (e.g. `book-reader`) and finish (no roles needed).
4. Open the new service account → **Keys → Add key → Create new key → JSON**. A file downloads. Keep it private.
5. From that JSON you need two values:
   - `client_email` → this is `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → this is `GOOGLE_PRIVATE_KEY`

## 2. The Google Sheet

1. Create a new, empty Google Sheet. Copy its ID from the URL: `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit` → `SHEET_ID`.
2. Click **Share**, paste the service account email (`client_email`), give it **Editor** access, and untick "notify".
3. Create the tabs automatically (after step 5 below, so your env vars exist): `npm run setup-sheet`. It creates any missing tab (`books`, `access_codes`, `admins`, `users`, `user_books`, `progress`, `passkeys`, `bookmarks`) and any missing header name. On an existing tab it only appends missing headers at the end of row 1: it never reorders columns or touches your rows. Once the site is running you can do the same from the website: `/admin` → **Mantenimiento** → **Actualizar base de datos** (see below).
4. Add yourself as admin. Run `npm run hash-password`, type a password (10+ characters), and copy the `$2b$12$…` hash it prints. In the `admins` tab, row 2: column A = username, column B = that hash.
   - If Sheets turns the hash into something odd, format column B as **Plain text** first.
   - The sheet holds only hashes: password hashes and code hashes. Do not share the Sheet with anyone you do not trust.

## 3. Cloudflare R2 bucket (private)

Page images live in a private R2 bucket. Nothing is public: readers only ever get a link that works for 60 seconds.

1. In the Cloudflare dashboard open **R2 Object Storage** (add a payment method if asked; the free tier is generous) and click **Create bucket**. Pick a name (this is `R2_BUCKET`) and leave the default location.
2. Leave the bucket private: in the bucket's **Settings**, keep **Public Development URL (r2.dev)** *disabled* and do **not** add a custom public domain.
3. Note your **Account ID** (shown on the R2 overview page, right side). This is `R2_ACCOUNT_ID`.
4. **Create an API token limited to this bucket:** R2 overview → **Manage API tokens** (or **API → Manage R2 API Tokens**) → **Create API token**.
   - Permissions: **Object Read & Write**.
   - **Specify bucket(s):** choose only your bucket.
   - Create it, then copy the **Access Key ID** (`R2_ACCESS_KEY_ID`) and **Secret Access Key** (`R2_SECRET_ACCESS_KEY`). The secret is shown only once.
5. **Add a CORS rule** so your browser may upload to and read from the bucket: bucket → **Settings → CORS Policy → Add CORS policy → JSON**, and paste (replace the domain with your real site):

```json
[
  {
    "AllowedOrigins": ["https://your-site.example.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": [],
    "MaxAgeSeconds": 3600
  }
]
```

   The origin must match exactly (scheme + host + port, no trailing slash). If you use a Vercel preview URL, add it too. Without this rule, uploads and page loads fail with a CORS error in the browser console.

## 4. Session secret

Generate a random value, e.g. `openssl rand -base64 48`. This is `SESSION_SECRET`. Changing it later signs everyone out.

## 5. Environment variables

**Locally:** copy `.env.example` to `.env.local` and fill in:

| Variable | Value |
| --- | --- |
| `SESSION_SECRET` | random string from step 4 |
| `HASH_PEPPER` | random string, 32+ characters (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`). Required in production. Keys the hash of access codes and activation codes; do not change it once codes exist |
| `APP_ORIGIN` (optional) | address(es) where Face ID / fingerprint sign-in may be used, e.g. `https://librostmc0.vercel.app` (comma separated). The Vercel production domain is allowed automatically |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key, in double quotes, keeping the `\n` sequences |
| `SHEET_ID` | from the Sheet URL |
| `R2_ACCOUNT_ID` | your Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | from the R2 API token |
| `R2_SECRET_ACCESS_KEY` | from the R2 API token |
| `R2_BUCKET` | the bucket name |
| `SITE_NAME` (optional) | defaults to `Libros` |
| `SITE_INTRO` (optional) | one line of text for the footer |
| `SITE_CONTACT` (optional) | line under the code box, e.g. how to ask for a code |
| `SITE_EMAIL`, `SITE_INSTAGRAM`, `SITE_WHATSAPP` (optional) | footer contact links; empty ones are hidden |

Leave `DATA_BACKEND` empty (or delete it) so the real services are used.

**On Vercel:** Project → **Settings → Environment Variables**, add every variable above for Production (and Preview if you use it). For `GOOGLE_PRIVATE_KEY`, paste the key exactly as it appears in the JSON file (with the `\n` sequences). Do **not** set `DATA_BACKEND` on Vercel: the server refuses to start in production with `DATA_BACKEND=mock`, or with a `SESSION_SECRET` or `HASH_PEPPER` shorter than 32 characters.

## 6. Deploy

1. Push the `book-reader` folder to a Git repository and import it at <https://vercel.com/new>, or run `npx vercel` from the folder.
2. Make sure the env vars from step 5 are set, then deploy (`npx vercel --prod`).
3. Visit `https://<your-domain>/admin`, sign in, upload a PDF.
4. In the book's **Códigos** panel, create codes, then use **Copiar enlace** and send it. The shareable link looks like `https://<your-domain>/b/<book>?code=XXXXXXXXXX`; the code is removed from the address bar as soon as it is used.

## Site name, wording and contact links (optional)

The site is called **Libros**. Change the name, the footer line and the code-screen contact line with `SITE_NAME`, `SITE_INTRO` and `SITE_CONTACT`. The footer shows contact links only for the ones you fill in: `SITE_EMAIL` (an address), `SITE_INSTAGRAM` (a handle or URL) and `SITE_WHATSAPP` (a phone number with country code, or a URL). Set them locally in `.env.local` and on Vercel under Environment Variables; leave them empty to hide them.

## Author, category and year

The upload and edit forms have optional **Autor**, **Categoría** and **Año** fields. They are stored as three extra columns on the `books` tab (`author`, `category`, `year`). Books created before this keep working without them. For a Sheet you created earlier, run `npm run setup-sheet` once: it adds the three header names to the `books` tab and leaves your data alone.

## Codes you choose yourself

In a book's **Códigos** panel pick **Aleatorios** (generated) or **Los elijo yo** (e.g. `AMINA2026`): 6 to 32 characters, letters, numbers and hyphens, not case-sensitive, unique within the book. **Cambiar código** swaps a code for a new one (typed or random) and the old one stops working at once, even for people already reading. The share link is built from the address you are using when you click **Copiar enlace**, so on your computer it is `http://localhost:3000/...` and on the live site it is your real domain. A book must be **Publicado** before readers can open it; the panel says so and has a one-click **Publicar** button.

## Mantenimiento: updating the Sheet from the website

New features sometimes need a new tab or a new column in the Sheet. Instead of running `npm run setup-sheet` on your computer, open `/admin` → **Mantenimiento** and click **Actualizar base de datos**. It does exactly what the script does, on the server: it creates any missing tab and writes any missing header name at the END of row 1. It never reorders, renames or deletes anything and never touches your data rows; running it again changes nothing and says **Todo al día**. The **Estado** table below the button shows every tab, its columns and what is missing. It can run 3 times a minute (it uses Google Sheets quota). Features that use the new columns appear at once; other server instances on Vercel notice within about 5 minutes.

## Things worth knowing

- **Codes are shown once.** They are stored hashed, so **Copiar enlace** only works right after you create or change them. To re-send one, use **Cambiar código** (keeps the label and expiry).
- **Revoking** blocks the reader's very next page load (up to 60 seconds on a busy deployment, because sheet reads are cached for 60 s).
- **Rate limiting** (5 failed attempts / 15 min / IP) is held in server memory. On Vercel each server instance has its own counter and counters reset when instances restart, so treat it as a speed bump, not a hard guarantee.
- **Large books and resume:** books up to ~800 MB are read from your disk in pieces (never loaded whole). Use desktop Chrome. If an upload is interrupted, the book stays in status `uploading`; click **Continuar subida** on it and select the same PDF: only the missing pages are sent, and the book gets the status you chose at the start. A different file is refused. **Cancelar** stops an upload and keeps every page already sent.
- **Vercel Hobby limits:** functions have a 4.5 MB request/response body limit. That is why page images go straight from your browser to R2. Each page image is far below that, and R2 uploads never touch a function anyway.
- **Deterrents are deterrents.** Pages are drawn on a canvas and right-click, drag, selection, Ctrl/Cmd+S and printing are blocked, but a determined reader can still screenshot a page. Pages carry no per-reader marking.


## Reader accounts (optional)

Besides access codes, readers can have an account (username + password, optional Face ID / fingerprint) so their books and reading progress follow them across devices. Access codes keep working for everyone, signed in or not.

1. Run `npm run setup-sheet` once. It creates the tabs `users`, `user_books`, `progress` and `passkeys` and never touches the existing ones.
2. In `/admin`, open **Usuarios** → create a user, choose their books (or "Todos los libros") and send them the one-time activation code with **Copiar mensaje de WhatsApp**. The code is shown once, lasts 72 hours and is cancelled after 5 wrong tries.
3. The reader opens `/activar`, enters username + code and chooses a password. From then on they sign in at `/entrar`.
4. **Restablecer contraseña** gives a new code, clears the password and the Face ID / fingerprint devices and signs the person out everywhere. **Desactivar** blocks the account; **Eliminar** removes it with its progress.

Google Sheets allows about 60 reads and 60 writes per minute for the whole app, so the account data is read with one request every 45 seconds at most, and reading progress is saved at most once every 20 seconds per book (plus once when the page is closed).
