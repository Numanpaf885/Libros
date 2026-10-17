"use client";
import { useEffect, useSyncExternalStore } from "react";
import Icon from "./Icon";

const read = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const apply = (t: "light" | "dark") => {
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
};

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, read, () => "light");

  // Until the reader makes a choice, follow the system when it changes.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // Safety net: on a client-rendered error page (e.g. an unknown book) the layout's inline script never ran.
    if (!document.documentElement.dataset.theme) {
      let stored: string | null = null;
      try { stored = localStorage.getItem("theme"); } catch { /* storage unavailable */ }
      apply(stored === "light" || stored === "dark" ? stored : mq.matches ? "dark" : "light");
    }
    const onChange = () => {
      try { if (localStorage.getItem("theme")) return; } catch { /* storage unavailable */ }
      apply(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={`btn btn-icon ${className}`}
      aria-label={next === "dark" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"}
      title={next === "dark" ? "Tema oscuro" : "Tema claro"}
      onClick={() => {
        apply(next);
        try { localStorage.setItem("theme", next); } catch { /* choice just won't persist */ }
      }}
    >
      {/* Both icons are rendered; CSS shows the right one from data-theme, so there is no wrong-icon flash before hydration. */}
      <Icon name="moon" className="theme-moon" />
      <Icon name="sun" className="theme-sun" />
    </button>
  );
}
