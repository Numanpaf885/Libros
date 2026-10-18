/** A simple strength estimate for the meter: length first, then variety. 0 (very weak) to 4 (very good). */
export function strength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "" };
  let pts = 0;
  if (pw.length >= 10) pts++;
  if (pw.length >= 14) pts++;
  if (pw.length >= 18) pts++;
  const kinds = [/[a-záéíóúñü]/, /[A-ZÁÉÍÓÚÑÜ]/, /\d/, /[^A-Za-z0-9áéíóúñüÁÉÍÓÚÑÜ]/].filter((r) => r.test(pw)).length;
  if (kinds >= 3) pts++;
  if (/^(.)\1+$/.test(pw) || new Set(pw).size < 5) pts = Math.min(pts, 0);
  const score = (pw.length < 10 ? Math.min(pts, 1) : pts) as 0 | 1 | 2 | 3 | 4;
  return { score, label: ["Muy débil", "Débil", "Aceptable", "Buena", "Muy buena"][score] };
}
