/** A colour as hue 0-360, saturation and value 0-1 - the shape a picker's square and strip move through. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** `#abc` or `#aabbcc` as `#rrggbb`, or null when it is neither. */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim().replace(/^#?/, "#").toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(trimmed)) return trimmed.replace(/[0-9a-f]/g, (c) => c + c);
  return /^#[0-9a-f]{6}$/.test(trimmed) ? trimmed : null;
}

export function hexToHsv(hex: string): Hsv {
  const full = normalizeHex(hex) ?? "#000000";
  const n = parseInt(full.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 1);
  const val = clamp(v, 0, 1);
  const channel = (n: number) => {
    const k = (n + hue / 60) % 6;
    return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[channel(5), channel(3), channel(1)]
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}
