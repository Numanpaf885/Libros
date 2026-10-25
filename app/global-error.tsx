"use client";
import "./globals.css";

// Last resort, if even the root layout fails: its own document, the same message and "Reintentar".
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="es">
      <body className="flex min-h-full flex-col bg-bg text-fg">
        <title>Libros</title>
        <main className="mx-auto w-full max-w-md flex-1 px-4 py-16" data-testid="page-error">
          <div role="alert" className="card p-6" data-testid="error-state">
            <p className="text-[17px] font-semibold">No se ha podido cargar la página</p>
            <p className="hint mt-1">El servicio no responde ahora mismo. Espera unos segundos y vuelve a intentarlo.</p>
            <button type="button" className="btn btn-primary mt-4 min-h-11" onClick={() => retry()}>Reintentar</button>
          </div>
        </main>
      </body>
    </html>
  );
}
