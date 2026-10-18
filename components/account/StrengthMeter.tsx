import { strength } from "@/lib/client/strength";

export default function StrengthMeter({ password }: { password: string }) {
  const { score, label } = strength(password);
  const color = score <= 1 ? "bg-danger" : score === 2 ? "bg-accent/60" : "bg-ok";
  return (
    <div aria-live="polite" className="mt-2">
      <div className="flex gap-1" role="meter" aria-label="Seguridad de la contraseña" aria-valuemin={0} aria-valuemax={4} aria-valuenow={score} aria-valuetext={label || "Vacía"}>
        {[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 flex-1 rounded-[2px] ${password && i <= score ? color : "bg-line"}`} />)}
      </div>
      <p className="hint mt-1 h-5">{password ? label : "Mínimo 10 caracteres. Mejor una frase larga."}</p>
    </div>
  );
}
