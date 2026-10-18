import { useId } from "react";

interface LogoProps {
  size?: number;
  className?: string;
  /** Decorative when the name is written next to it (default). Set a label to expose it to screen readers. */
  label?: string;
  /** Opening animation: the book / ground part tilts by (1 - --lp) and levels out as --lp goes to 1. */
  tilt?: boolean;
}

/**
 * The Horizonte mark. The shapes are copied verbatim from brand/icon.svg (do not redraw them);
 * colour comes from currentColor, ids are unique per instance.
 */
export function Logo({ size = 30, className = "", label, tilt = false }: LogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clip = `hz-${uid}-in`;
  const mask = `hz-${uid}-m`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`logo-mark shrink-0 ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      <defs>
        <clipPath id={clip}><circle cx="32" cy="32" r="22.6" /></clipPath>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d="M32 39 V60" stroke="#000" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M12.5 48.5 Q22.5 42 32 47.5 Q41.5 42 51.5 48.5" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" />
        </mask>
      </defs>
      <circle cx="32" cy="32" r="27.5" fill="none" stroke="currentColor" strokeWidth="4" />
      <g clipPath={`url(#${clip})`}>
        <g className={tilt ? "logo-ground" : undefined}>
          <path mask={`url(#${mask})`} fill="currentColor" d="M4 41 Q18 30 32 39 Q46 30 60 41 L60 64 L4 64 Z" />
        </g>
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 24 H26.5 V28" />
        <path d="M49 24 H37.5 V28" />
      </g>
      <circle cx="32" cy="24" r="3" fill="currentColor" />
    </svg>
  );
}

/** Mark + wordmark (+ course name from 640 px). Colour: the accent token, both themes. */
export function LogoLockup({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo size={30} className="text-accent" />
      <span className="lockup-title inline-flex items-baseline gap-2.5">
        <span className="font-serif text-[22px] font-semibold leading-none tracking-tight text-fg">{name}</span>
        <span className="hidden text-[13px] leading-none text-glass-muted sm:inline">Aviónica · TMC0</span>
      </span>
    </span>
  );
}
