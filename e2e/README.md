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

Texto seleccionable (subida con texto, capa del lector, copiar, alineación, «Extraer texto», reanudar, OCR, `allow_copy`, seguridad) y rendimiento:

```bash
DATA_BACKEND=mock npx next dev -p 3100
node e2e/text.mjs                       # SCREENSHOTS=1 guarda capturas en screenshots/
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

`BASE` (por defecto `http://localhost:3100`) y `CHROME_PATH` se pueden cambiar con variables de entorno.
