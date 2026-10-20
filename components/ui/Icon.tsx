// Small authored icon set: one 24px grid, one 1.5 stroke, round caps. No icon dependency.
const P = {
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  copy: "M9 9h10v10H9zM5 15V5h10",
  zoomIn: "M12 5v14M5 12h14",
  zoomOut: "M5 12h14",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  fitWidth: "M4 5v14M20 5v14M8 12h8M8 12l2.5-2.5M8 12l2.5 2.5M16 12l-2.5-2.5M16 12l-2.5 2.5",
  fitPage: "M7 3h10v18H7zM12 7v10M12 7l-2 2M12 7l2 2M12 17l-2-2M12 17l2-2",
  upload: "M12 16V5m0 0L8 9m4-4l4 4M5 19h14",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1",
  continuous: "M7 4h10v6H7zM7 14h10v6H7z",
  single: "M7 3h10v18H7z",
  pages: "M8 3h12v14H8zM4 7v14h12",
  book: "M5 5.5A1.5 1.5 0 016.5 4H19v14H6.5A1.5 1.5 0 005 19.5v-14zM5 19.5A1.5 1.5 0 006.5 21H19",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z",
  unlock: "M7 11V8a5 5 0 019.5-2M6 11h12v9H6z",
  sun: "M16 12a4 4 0 11-8 0 4 4 0 018 0zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  menu: "M4 7h16M4 12h16M4 17h16",
  key: "M10 12a4 4 0 11-8 0 4 4 0 018 0zM10 12h11M18 12v3M15 12v2",
  device: "M4 6h16v11H4zM2 20h20",
  arrow: "M5 12h14M13 6l6 6-6 6",
  bookmark: "M7 4h10v16l-5-4-5 4z",
  bookmarks: "M9 3h9v14l-4.5-3.5L9 17zM5 7v14l4.5-3.5",
  edit: "M5 19l1-4 9.5-9.5 3 3L9 18zM13.5 7.5l3 3",
  trash: "M5 7h14M10 4h4M7 7l1 13h8l1-13M10 11v5M14 11v5",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 19h14",
  rotate: "M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4h-4",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  star: "M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9.5h.01",
  more: "M4.5 12a1 1 0 102 0 1 1 0 10-2 0M11 12a1 1 0 102 0 1 1 0 10-2 0M17.5 12a1 1 0 102 0 1 1 0 10-2 0",
} as const;
export type IconName = keyof typeof P;
export default function Icon({ name, size = 20, className = "", filled = false }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={P[name]} />
    </svg>
  );
}
