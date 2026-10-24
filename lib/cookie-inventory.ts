// Every cookie and every key the site keeps in the browser. /cookies shows this list as a table and the browser test
// (e2e/legal.mjs) checks that what a real visit stores is exactly this. A new cookie or storage key must be added here.
// Only "Técnica necesaria" and "Preferencia" are allowed without consent (LSSI-CE art. 22.2): anything else (analytics,
// advertising) needs a real consent banner with "Rechazar" BEFORE it is set.

export type StorageKind = "Cookie" | "localStorage" | "IndexedDB";
export type StorageType = "Técnica necesaria" | "Preferencia";
export interface StorageItem {
  /** as shown; "<libro>" and similar stand for the part that changes */
  name: string;
  /** matches the real name (the test uses it) */
  pattern: string;
  kind: StorageKind;
  purpose: string;
  duration: string;
  type: StorageType;
  /** "reader": anyone using the site; "admin": only the administrator's browser */
  scope: "reader" | "admin";
}

export const STORAGE_ITEMS: StorageItem[] = [
  { name: "br_u", pattern: "^br_u$", kind: "Cookie", purpose: "Mantiene abierta tu sesión después de entrar con tu usuario.", duration: "30 días", type: "Técnica necesaria", scope: "reader" },
  { name: "br_b_<libro>", pattern: "^br_b_[0-9a-f]{16}$", kind: "Cookie", purpose: "Recuerda que has desbloqueado ese libro con un código de acceso.", duration: "30 días o hasta que caduque el código", type: "Técnica necesaria", scope: "reader" },
  { name: "br_pk", pattern: "^br_pk$", kind: "Cookie", purpose: "Comprobación de un solo uso al entrar o al activar Face ID o huella.", duration: "5 minutos", type: "Técnica necesaria", scope: "reader" },
  { name: "theme", pattern: "^theme$", kind: "localStorage", purpose: "El tema claro u oscuro que has elegido.", duration: "Hasta que lo borres", type: "Preferencia", scope: "reader" },
  { name: "br:cookies", pattern: "^br:cookies$", kind: "localStorage", purpose: "Recuerda que ya has cerrado el aviso de cookies.", duration: "Hasta que lo borres", type: "Preferencia", scope: "reader" },
  { name: "br:mode", pattern: "^br:mode$", kind: "localStorage", purpose: "El modo de lectura elegido (libro o PDF).", duration: "Hasta que lo borres", type: "Preferencia", scope: "reader" },
  { name: "br:effect", pattern: "^br:effect$", kind: "localStorage", purpose: "El efecto al pasar página elegido.", duration: "Hasta que lo borres", type: "Preferencia", scope: "reader" },
  { name: "br:select", pattern: "^br:select$", kind: "localStorage", purpose: "Si tienes activado «Seleccionar texto».", duration: "Hasta que lo borres", type: "Preferencia", scope: "reader" },
  { name: "br:last:<libro>", pattern: "^br:last:[a-z0-9-]+$", kind: "localStorage", purpose: "La última página que leíste de ese libro, para continuar donde lo dejaste.", duration: "Hasta que lo borres", type: "Técnica necesaria", scope: "reader" },
  { name: "br:bm:<libro>", pattern: "^br:bm:[a-z0-9-]+$", kind: "localStorage", purpose: "Una copia de tus marcadores de ese libro, para verlos al momento.", duration: "Hasta que lo borres", type: "Técnica necesaria", scope: "reader" },
  { name: "br:bmq:<libro>", pattern: "^br:bmq:[a-z0-9-]+$", kind: "localStorage", purpose: "Los cambios en tus marcadores que aún no se han guardado (por ejemplo, sin conexión).", duration: "Hasta que se guardan", type: "Técnica necesaria", scope: "reader" },
  { name: "br:pk-offer:<usuario>", pattern: "^br:pk-offer:[0-9a-f-]{36}$", kind: "localStorage", purpose: "Recuerda que ya te ofrecimos activar Face ID o huella, para no repetirlo.", duration: "Hasta que lo borres", type: "Preferencia", scope: "reader" },
  { name: "br_admin", pattern: "^br_admin$", kind: "Cookie", purpose: "Mantiene abierta la sesión del administrador.", duration: "8 horas", type: "Técnica necesaria", scope: "admin" },
  { name: "br:fp:<libro>, br:status:<libro>", pattern: "^br:(fp|status):[0-9a-f-]{36}$", kind: "localStorage", purpose: "Permiten continuar una subida de libro interrumpida.", duration: "Hasta que termina la subida", type: "Técnica necesaria", scope: "admin" },
  { name: "br:orig:<libro>", pattern: "^br:orig:[0-9a-f-]{36}$", kind: "localStorage", purpose: "Permite continuar la subida interrumpida del PDF original.", duration: "Hasta que termina la subida", type: "Técnica necesaria", scope: "admin" },
  { name: "keyval-store", pattern: "^keyval-store$", kind: "IndexedDB", purpose: "Guarda los datos del reconocimiento de texto (OCR) para no descargarlos cada vez.", duration: "Hasta que lo borres", type: "Técnica necesaria", scope: "admin" },
];
