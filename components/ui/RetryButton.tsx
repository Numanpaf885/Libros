"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import Icon from "./Icon";

/** "Reintentar" for a server-rendered page that rendered without some of its data: renders it again. */
export default function RetryButton({ className = "btn btn-sm" }: { className?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <button type="button" className={className} disabled={busy} aria-busy={busy} onClick={() => start(() => router.refresh())}>
      <Icon name="rotate" size={16} />Reintentar
    </button>
  );
}
