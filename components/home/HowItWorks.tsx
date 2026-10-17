import Icon, { type IconName } from "@/components/ui/Icon";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "book", title: "Elige un libro", text: "Explora el catálogo y abre la ficha del libro que te interese." },
  { icon: "key", title: "Introduce tu código", text: "El autor te da un código personal. Lo escribes una vez en la ficha del libro." },
  { icon: "device", title: "Lee en cualquier dispositivo", text: "Ordenador, tableta o móvil: el libro se abre en el navegador, sin instalar nada." },
];

export default function HowItWorks() {
  return (
    <section id="como-funciona" aria-labelledby="como" className="border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6">
        <h2 id="como" className="text-3xl">Cómo funciona</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl border border-line-strong text-accent"><Icon name={s.icon} /></span>
              <div>
                <h3 className="font-sans text-lg font-semibold"><span className="sr-only">Paso {i + 1}: </span>{s.title}</h3>
                <p className="mt-1 text-[15px] text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
