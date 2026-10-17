"use client";
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
/** Native <dialog>: focus trap, Esc to close and inert background come for free. */
export default function ConfirmDialog({ open, title, children, confirmLabel, danger, confirmDisabled, busy, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClick={(e) => { if (e.target === ref.current) onCancel(); }}
      className="m-auto w-[min(92vw,30rem)] rounded-card border border-line-strong bg-bg p-0 text-fg shadow-sm backdrop:bg-black/50 "
    >
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (!confirmDisabled && !busy) onConfirm(); }} className="space-y-4 p-6">
        <h2 className="text-2xl">{title}</h2>
        <div className="space-y-3 text-[15px] text-muted">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button type="submit" disabled={confirmDisabled || busy} className={`btn ${danger ? "btn-danger" : "btn-primary"}`}>{busy ? "Un momento…" : confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}
