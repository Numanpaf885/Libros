"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import Icon from "./Icon";

type Kind = "ok" | "error";
interface ToastAction { label: string; onClick: () => void }
interface Toast { id: number; kind: Kind; text: string; action?: ToastAction }
const Ctx = createContext<(kind: Kind, text: string, action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((kind: Kind, text: string, action?: ToastAction) => {
    const id = nextId.current++;
    setItems((l) => [...l.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === "error" || action ? 6500 : 3500);
  }, []);
  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id));
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }} aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast-in pointer-events-auto flex max-w-md items-start gap-3 rounded-card border bg-bg px-4 py-3 text-[15px] shadow-[var(--shadow-float)] ${t.kind === "error" ? "border-danger" : "border-ok"}`}>
            <Icon name={t.kind === "error" ? "close" : "check"} className={t.kind === "error" ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-ok"} />
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && <button type="button" className="-my-1 -mr-2 min-h-9 shrink-0 rounded-ctl px-3 text-[15px] font-medium text-accent hover:bg-fg/10" onClick={() => { t.action?.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
