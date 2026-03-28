export function polygonAreaAbs(poly) {
  if (!poly || poly.length < 3) return 0;
  let area2 = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) * 0.5;
}

export function polygonCentroid(poly) {
  if (!poly || poly.length < 3) return { x: 0, y: 0 };
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = a.x * b.y - b.x * a.y;
    area2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area2) < 1e-8) return { x: 0, y: 0 };
  const inv = 1 / (3 * area2);
  return { x: cx * inv, y: cy * inv };
}

export function clamp01(v) {
  return Math.min(Math.max(v, 0), 1);
}
