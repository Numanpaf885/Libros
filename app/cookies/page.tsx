import Link from "next/link";
import LegalPage, { Owner } from "@/components/legal/LegalPage";
import { STORAGE_ITEMS, type StorageItem } from "@/lib/cookie-inventory";
import { getLegal } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Política de cookies" };

const code = "rounded-[4px] bg-fg/[0.06] px-1.5 py-0.5 font-mono text-[14px]";

function Table({ items, label }: { items: StorageItem[]; label: string }) {
  return (
    <div role="table" aria-label={label} className="mt-4 md:card md:overflow-hidden">
      <div role="row" className="hidden border-b border-line bg-surface/60 px-4 py-2.5 text-sm text-muted md:grid md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,9rem)_minmax(0,8rem)] md:gap-4">
        <span role="columnheader">Nombre</span><span role="columnheader">Para qué sirve</span><span role="columnheader">Duración</span><span role="columnheader">Tipo</span>
      </div>
      <ul role="rowgroup" className="space-y-3 md:space-y-0">
        {items.map((it) => (
          <li key={it.name} role="row" data-storage={it.name} data-kind={it.kind} data-scope={it.scope}
            className="card p-4 text-[15px] leading-6 md:grid md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_minmax(0,9rem)_minmax(0,8rem)] md:gap-4 md:rounded-none md:border-x-0 md:border-b-0 md:border-t md:bg-transparent first:md:border-t-0">
            <div role="cell" className="min-w-0">
              <code className={`${code} [overflow-wrap:anywhere]`}>{it.name}</code>
              <span className="mt-1 block text-sm text-muted">{it.kind}</span>
            </div>
            <div role="cell" className="mt-2 md:mt-0">{it.purpose}</div>
            <div role="cell" className="mt-2 md:mt-0"><span className="text-muted md:hidden">Duración: </span>{it.duration}</div>
            <div role="cell" className="mt-1 md:mt-0"><span className="text-muted md:hidden">Tipo: </span>{it.type}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// LSSI-CE art. 22.2: only cookies and storage that are strictly necessary or that keep a preference you chose, so no
// consent is needed. The list comes from lib/cookie-inventory.ts (the browser test checks it against a real visit).
export default async function CookiesPage() {
  const legal = await getLegal();
  const reader = STORAGE_ITEMS.filter((i) => i.scope === "reader");
  const admin = STORAGE_ITEMS.filter((i) => i.scope === "admin");
  return (
    <LegalPage title="Política de cookies" legal={legal}>
      <p>Las cookies son pequeños archivos que una web guarda en tu navegador. Esta web también guarda algunos datos en el almacenamiento de tu navegador (localStorage). Aquí tienes la lista completa, según el artículo 22.2 de la Ley 34/2002 (LSSI-CE).</p>
      <p><strong>Esta web solo usa cookies técnicas necesarias y preferencias guardadas en tu dispositivo.</strong> No usa cookies de análisis ni de publicidad, ni cookies de terceros. Por eso no te pedimos permiso: estas cookies están exentas de consentimiento. Las estadísticas de visitas (Vercel Web Analytics) son anónimas y no usan cookies ni guardan nada en tu navegador.</p>

      <h2>Cookies y datos guardados en tu navegador</h2>
      <Table items={reader} label="Cookies y almacenamiento de la web" />
      <p className="hint">Las cookies de esta web son HttpOnly: solo las lee el servidor de la web, nunca otras páginas.</p>

      <h2>Solo para la administración</h2>
      <p>Estas solo se guardan en el navegador del administrador de la web.</p>
      <Table items={admin} label="Cookies y almacenamiento de la administración" />

      <h2>Cómo borrarlas</h2>
      <p>Puedes borrar las cookies y los datos guardados desde los ajustes de tu navegador (por ejemplo, «Borrar datos de navegación»). Si lo haces, se cerrará tu sesión y volverás a ver este aviso, pero tu progreso y tus marcadores siguen guardados en tu cuenta.</p>
      <p>Para cualquier duda sobre las cookies o tus datos, consulta la <Link href="/privacidad">Política de privacidad</Link>.</p>

      <h2>Contacto</h2>
      <Owner legal={legal} />
    </LegalPage>
  );
}
