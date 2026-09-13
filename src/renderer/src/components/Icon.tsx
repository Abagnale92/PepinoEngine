const PATHS: Record<string, string> = {
  select: "M3.5 2l8.5 5-3.8 1.1L6.3 12z",
  paint: "M10.5 2.5l3 3-6.5 6.5-3-3zM4 12l-1.5 1.5",
  erase: "M6 13.5h8M2.5 9.5l6-6 4.5 4.5-5.5 5.5H6z",
  grid: "M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12",
  collision: "M2 2h12v12H2zM2 8l6-6M2 14L14 2M8 14l6-6",
  snap: "M4 2v6a4 4 0 008 0V2M4 5.5h2.5M9.5 5.5H12",
  undo: "M5.5 3L2.5 6l3 3M2.5 6h7a3.5 3.5 0 010 7H6",
  redo: "M10.5 3l3 3-3 3M13.5 6h-7a3.5 3.5 0 000 7H10",
  play: "M4.5 2.5v11l9-5.5z",
  stop: "M4 4h8v8H4z",
  pause: "M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z",
  step: "M3.5 3v10l6.5-5zM12 3v10",
  restart: "M13 8a5 5 0 11-1.6-3.7M13.2 2.5v2.8h-2.8",
  save: "M3 2h8l2 2v10H3zM5.5 2v3.5h4.5V2M5 14V9.5h6V14",
  folder: "M2 4h4.2l1.5 1.5H14V13H2z",
  export: "M8 2v8.5M5 5l3-3 3 3M3 10v4h10v-4",
  plus: "M8 3v10M3 8h10",
  eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z",
  eyeOff: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM2.5 2.5l11 11",
  lock: "M5 7V5a3 3 0 016 0v2M3.5 7h9v7h-9z",
  unlock: "M5 7V5a3 3 0 015.8-1M3.5 7h9v7h-9z",
  trash: "M3 4h10M6.2 4V2.5h3.6V4M4.5 4l.7 9.5h5.6l.7-9.5",
  layers: "M8 2L1.5 5.5 8 9l6.5-3.5zM1.5 8.3L8 11.8l6.5-3.5M1.5 11L8 14.5l6.5-3.5",
  cube: "M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7",
  chevron: "M6 4l4 4-4 4",
  close: "M4 4l8 8M12 4l-8 8",
  copy: "M5.5 5.5h7.5v8.5H5.5zM3 10.5V2.5h7.5",
  link: "M6.5 9.5l3-3M7 4.6l1.2-1.2a2.5 2.5 0 013.5 3.5L10.5 8M9 11.4l-1.2 1.2a2.5 2.5 0 01-3.5-3.5L5.5 8",
  image: "M2 3h12v10H2zM2 11l3.5-3.5 3 3L11 8l3 3",
  sound: "M2 6h3l4-3v10l-4-3H2zM11 5.5a3.5 3.5 0 010 5M12.8 3.5a6 6 0 010 9",
  settings: "M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
  text: "M3 3.5h10M8 3.5v10M6 13.5h4",
  rules: "M2.5 4h2M6.5 4h7M2.5 8h2M6.5 8h7M2.5 12h2M6.5 12h7",
  chat: "M2.5 3h11v7.5H8l-3.5 2.5v-2.5h-2zM5 6h6M5 8h4",
  up: "M4 10l4-4 4 4",
  down: "M4 6l4 4 4-4",
  person: "M8 2.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM3.5 14c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5",
  door: "M4 14V2.5h8V14M2.5 14h11M9.5 8.5v1",
  coin: "M8 2.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM8 5v6",
  enemy: "M3 12c0-4 2.2-7 5-7s5 3 5 7zM6 8.5v1M10 8.5v1",
  bug: "M5.5 5.5h5v6a2.5 2.5 0 01-5 0zM8 5.5V3M3 8h2.5M10.5 8H13M3.5 12l2-1M12.5 12l-2-1M6 3l1 1.5M10 3L9 4.5",
};

const FILLED = new Set(["play", "stop", "pause"]);

export function Icon({ name, size = 15, className }: { name: string; size?: number; className?: string }) {
  const d = PATHS[name] ?? PATHS.cube;
  const filled = FILLED.has(name);
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
