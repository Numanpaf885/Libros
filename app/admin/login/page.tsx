"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/brand/Logo";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function AdminLogin() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: f.get("username"), password: f.get("password") }),
    });
    if (res.ok) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    const msg = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    setError(res.status === 429 && msg ? msg : res.status === 429 ? "Demasiados intentos. Inténtalo de nuevo más tarde." : "Usuario o contraseña incorrectos");
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-4 flex justify-end"><ThemeToggle /></div>
      <form onSubmit={submit} className="card flex flex-col gap-5 p-6 sm:p-8">
        <div>
          <Logo size={40} className="mb-3 text-accent" />
          <h1 className="text-4xl">Administración</h1>
          <p className="hint mt-1">Entra para gestionar tus libros y códigos.</p>
        </div>
        <div>
          <label htmlFor="username" className="label">Usuario</label>
          <input id="username" name="username" autoComplete="username" required className="field" />
        </div>
        <div>
          <label htmlFor="password" className="label">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
        </div>
        {error && <p role="alert" className="err">{error}</p>}
        <button disabled={busy} className="btn btn-primary">{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </main>
  );
}
