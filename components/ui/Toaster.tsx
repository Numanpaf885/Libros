"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import Icon from "./Icon";

type Kind = "ok" | "error";
interface Toast { id: number; kind: Kind; text: string }
const Ctx = createContext<(kind: Kind, text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((kind: Kind, text: string) => {
    const id = nextId.current++;
    setItems((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === "error" ? 6500 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id} className={`fade-in pointer-events-auto flex max-w-md items-start gap-3 rounded-card border bg-surface px-4 py-3 text-[15px] shadow-sm ${t.kind === "error" ? "border-danger" : "border-ok"}`}>
            <Icon name={t.kind === "error" ? "close" : "check"} className={t.kind === "error" ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-ok"} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
