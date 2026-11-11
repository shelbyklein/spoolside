// Which order colorway a spool's color belongs to, judged the way a person would: in CIELAB, where grey is
// grey however close its RGB numbers sit to a green, and lime is still green. Shared by the server's
// print offers and the app's print dialog.

// Store colorway names and the color each is, as a reference point.
export const COLORWAYS = {
  red: "#e0201b", green: "#3baa35", blue: "#2f6fd6", black: "#111111", grey: "#8a8a8a", white: "#f2f2f2",
  orange: "#f07818", purple: "#7e3fb5", pink: "#f06eaa", yellow: "#f5d000", teal: "#0f8c8c",
};
const NEUTRAL = new Set(["black", "grey", "white"]);
export const colorwayName = (name) => {
  const n = String(name || "").trim().toLowerCase();
  return n === "gray" ? "grey" : n;
};

export function lab(hex) {
  const v = [1, 3, 5].map((i) => (parseInt(String(hex).slice(i, i + 2), 16) || 0) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const [r, g, b] = v;
  const xyz = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883];
  const [fx, fy, fz] = xyz.map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// CIEDE2000 colour difference: about 1 is just noticeable, 10+ is clearly different.
export function deltaE(hexA, hexB) {
  const [L1, a1, b1] = lab(hexA), [L2, a2, b2] = lab(hexB);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * deg + 360) % 360);
  const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = h1 + h2;
  if (Cp1 * Cp2) hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cpm, SH = 1 + 0.015 * Cpm * T;
  const RT = -2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

// Hue ranges (CIELAB hue angle, degrees) for each coloured colorway, set from Bambu's spool colours and
// common named colours: e.g. lime (127°) and forest (138°) are green, navy (283°) blue, lilac (307°) purple.
const HUES = [[20, "red"], [48, "orange"], [75, "yellow"], [112, "green"], [175, "teal"], [230, "blue"], [298, "purple"], [335, "pink"]];

// The colorway a spool color reads as. Barely-coloured spools are black, grey or white by lightness;
// everything else goes by its hue.
export function colorFamily(hex) {
  const [L, a, b] = lab(hex);
  if (Math.hypot(a, b) < 14) return L < 28 ? "black" : L > 88 ? "white" : "grey";
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  let name = "pink"; // 335°–20° wraps around
  for (const [from, n] of HUES) if (h >= from) name = n;
  return name;
}

// Does this spool print the order's colorway? Unknown colorways never match by themselves.
export const matchesColorway = (hex, colorway) => {
  const name = colorwayName(colorway);
  return !!hex && name in COLORWAYS && colorFamily(hex) === name;
};
