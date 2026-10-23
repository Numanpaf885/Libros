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
MOCK_MISSING_TABS=bookmarks MOCK_MISSING_COLUMNS=original_pdf_size,original_pdf_pages DATA_BACKEND=mock npx next dev -p 3100
node e2e/maintenance.mjs                # SCREENSHOTS=1 guarda capturas en screenshots/
```

`BASE` (por defecto `http://localhost:3100`) y `CHROME_PATH` se pueden cambiar con variables de entorno.
