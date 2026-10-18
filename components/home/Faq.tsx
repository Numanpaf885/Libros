import Icon from "@/components/ui/Icon";

const QA = [
  { q: "¿Cómo consigo un código?", a: "Te lo da directamente el propietario o quien comparte el libro contigo. Cada código es personal y solo abre el libro para el que se creó." },
  { q: "¿Puedo leer en el móvil?", a: "Sí. El lector se adapta a cualquier pantalla: desliza para cambiar de página, pellizca o usa los botones para ampliar y pásate al modo continuo si prefieres desplazarte." },
  { q: "¿Se guarda mi página?", a: "Sí. Recordamos por dónde ibas en este navegador, así que al volver puedes continuar donde lo dejaste. Si cambias de dispositivo empezarás desde el principio." },
];

export default function Faq() {
  return (
    <section aria-labelledby="faq" className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6">
      <h2 id="faq" className="text-3xl">Preguntas frecuentes</h2>
      <div className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
        {QA.map((x) => (
          <details key={x.q} className="group py-4">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium [&::-webkit-details-marker]:hidden">
              {x.q}
              <Icon name="down" className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <p className="mt-2 max-w-prose text-[15px] text-muted">{x.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
