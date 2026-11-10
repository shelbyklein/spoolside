// A part's placement in an assembly, in STL coordinates (Z up): [x, y, z, turn, tiltX, tiltY].
// x, y, z are mm; turn is degrees around the vertical (Z) axis; tiltX and tiltY are degrees around
// the X and Y axes, for parts that sit at an angle (e.g. a touch pin leaning into a membrane dome).
// Each copy rotates about its STL's origin: tilt first (X, then Y), then turn, then the offset,
// so world = offset + Rz(turn) · Ry(tiltY) · Rx(tiltX) · point.
export type Placement = number[];

const rad = (deg = 0) => (deg * Math.PI) / 180;

// Sets an object's position and rotation from a placement.
export function applyPlacement(obj: { position: { set(x: number, y: number, z: number): unknown }; rotation: { set(x: number, y: number, z: number, order?: any): unknown } }, p: Placement) {
  const [x = 0, y = 0, z = 0, turn = 0, tiltX = 0, tiltY = 0] = p;
  obj.position.set(x, y, z);
  obj.rotation.set(rad(tiltX), rad(tiltY), rad(turn), "ZYX");
}

// Rounds to 0.01 and drops trailing zero angles, so plain placements stay [x, y, z] or [x, y, z, turn].
export function packPlacement(p: Placement): Placement {
  const out = p.slice(0, 6).map((n) => Math.round((n || 0) * 100) / 100);
  while (out.length > 3 && !out[out.length - 1]) out.pop();
  return out;
}

// Merges an edit into a copy's placement. An edit gives x, y, z and, optionally, the angles it
// changes; angles it leaves out (e.g. a drag reports only the turn) keep their previous values.
export function mergePlacement(prev: Placement, edit: Placement): Placement {
  const full = [0, 1, 2, 3, 4, 5].map((i) => (i < edit.length ? edit[i] : prev[i] ?? 0));
  return packPlacement(full);
}
