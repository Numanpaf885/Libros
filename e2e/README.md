# Pruebas de navegador (modo simulado)

Comprueban el diseño en móvil, el menú, el cursor y los botones. Solo se usan con datos **simulados**: crean y renombran libros y usuarios de prueba.

```bash
DATA_BACKEND=mock npx next dev -p 3100        # en otra terminal
npm i --no-save playwright-core                # no se añade a package.json
node e2e/overflow.mjs   # ninguna página es más ancha que la pantalla (320–768 px, con y sin sesión)
node e2e/menu.mjs       # el menú del móvil no mueve la página y cabe en pantalla
node e2e/cursor.mjs     # todo lo clicable muestra la mano; ningún div/span con onClick
node e2e/buttons.mjs    # hover, pulsado, foco, carga, táctil y movimiento reducido
```

Mantenimiento (`/admin` → «Actualizar base de datos»): necesita un servidor cuya hoja simulada no tenga una pestaña y dos columnas. El encabezado simulado vive en memoria, así que reinicia el servidor para repetirla.

```bash
MOCK_MISSING_TABS=bookmarks MOCK_MISSING_COLUMNS=text_pages,allow_copy DATA_BACKEND=mock npx next dev -p 3100
node e2e/maintenance.mjs                # SCREENSHOTS=1 guarda capturas en screenshots/
```

Texto seleccionable (subida con texto, capa del lector, copiar, alineación, «Extraer texto», reanudar, OCR, `allow_copy`, seguridad), selección con material en los márgenes (`selection.mjs`: el texto girado nunca se selecciona, la cabecera y el pie solo si el arrastre empieza en ellos, orden de lectura por columnas, fragmentos antiguos sin `r`, aviso «Vuelve a extraer» y OCR de la misma página) y rendimiento:

```bash
DATA_BACKEND=mock npx next dev -p 3100
node e2e/text.mjs                       # SCREENSHOTS=1 guarda capturas en screenshots/
node e2e/selection.mjs                  # página con márgenes: título lateral girado, cabecera, pie, nota y dos columnas
node e2e/perf-turn.mjs                  # fps al pasar página (doble página y móvil)
npm run build && node e2e/bundle-size.mjs   # tamaño del JS del lector; comprueba que no lleva pdf.js ni tesseract.js
```

Contacto, «Mensajes», «Ajustes legales», páginas legales, aviso de cookies, `/activar`, «Exportar datos» y «Anonimizar». `legal.mjs` también graba todas las cookies y claves de almacenamiento de una visita real (leer, entrar, desbloquear, descargar, cambiar el tema) y comprueba que coinciden exactamente con la tabla de `/cookies` (`lib/cookie-inventory.ts`):

```bash
DATA_BACKEND=mock npx next dev -p 3100
node e2e/legal.mjs                      # SCREENSHOTS=1 guarda capturas en screenshots/
MOCK_MISSING_TABS=messages,settings DATA_BACKEND=mock npx next dev -p 3100   # reinicia para repetir
node e2e/legal-missing.mjs              # sin las pestañas nuevas: todo funciona y las secciones lo dicen
```

## Con el adaptador real de Google contra una API de Google simulada

El modo simulado normal no se parece a Google en lo que más importa cuando algo falla. `e2e/fake-sheets.mjs` es una API de Google Sheets falsa que sí lo hace:
- una lectura que nombra una pestaña que no existe falla entera (400 «Unable to parse range»), aunque las demás existan;
- respuestas lentas y errores 429 de cuota (forzados, o un límite de 60 lecturas por minuto como el de Google);
- columnas en cualquier orden, más una columna desconocida.

Con `FAKE_SHEETS_URL`, el servidor de pruebas usa el adaptador **real** (`lib/db/sheets.ts`) contra ella. Las imágenes siguen en `.data/blobs`.

Resistencia (permanente: este tipo de fallo no debe volver):
- pestañas que faltan, y luego «Actualizar base de datos»;
- Google que tarda 15 s, Google que responde 429, y la recuperación;
- `/api/health`.

La prueba arranca su propia API falsa:

```bash
FAKE_SHEETS_URL=http://localhost:3999 DATA_BACKEND=mock npx next dev -p 3100
node e2e/resilience.mjs
```

Todas las demás pruebas, con las columnas de cada pestaña desordenadas (`FAKE_SHUFFLE=1`). Las variables `MOCK_MISSING_*` de cada prueba se le pasan a la API falsa:

```bash
FAKE_SHUFFLE=1 node e2e/fake-sheets.mjs &
FAKE_SHEETS_URL=http://localhost:3999 DATA_BACKEND=mock npx next dev -p 3100
FAKE_SHUFFLE=1 node e2e/overflow.mjs     # y el resto
```

La API falsa lee y escribe `.data/mock-sheet.json` en el orden de columnas de la aplicación, así que las pruebas que miran ese archivo funcionan igual.

`BASE` (por defecto `http://localhost:3100`) y `CHROME_PATH` se pueden cambiar con variables de entorno.
