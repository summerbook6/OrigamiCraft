import { THREE } from "../lib/three.js";

export function polygonToGeometry(poly, w, h) {
  const geometry = new THREE.BufferGeometry();
  if (!poly || poly.length < 3) return geometry;

  const positions = [];
  const uvs = [];
  for (let i = 1; i < poly.length - 1; i += 1) {
    const a = poly[0];
    const b = poly[i];
    const c = poly[i + 1];
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, 0);
      uvs.push((p.x + w * 0.5) / w, (p.y + h * 0.5) / h);
    }
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function makePolygonEdge(poly) {
  const pts = poly.map((p) => new THREE.Vector3(p.x, p.y, 0.0015));
  if (poly.length > 0) pts.push(new THREE.Vector3(poly[0].x, poly[0].y, 0.0015));
  const geom = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(
    geom,
    new THREE.LineBasicMaterial({ color: 0x6e7482, transparent: true, opacity: 0.8 })
  );
}

export function getRectPolygon(w, h) {
  const hw = w * 0.5;
  const hh = h * 0.5;
  return [
    new THREE.Vector2(-hw, -hh),
    new THREE.Vector2(hw, -hh),
    new THREE.Vector2(hw, hh),
    new THREE.Vector2(-hw, hh),
  ];
}

export function isInsideRect(x, y, w, h) {
  return Math.abs(x) <= w * 0.5 && Math.abs(y) <= h * 0.5;
}

export function distancePointToLine(point, p0, p1) {
  const dir = new THREE.Vector2().subVectors(p1, p0);
  const rel = new THREE.Vector2().subVectors(point, p0);
  const area2 = Math.abs(dir.x * rel.y - dir.y * rel.x);
  return area2 / Math.max(dir.length(), 1e-6);
}

function lineSideValue(point, p0, p1) {
  const dir = new THREE.Vector2().subVectors(p1, p0);
  const rel = new THREE.Vector2().subVectors(point, p0);
  return dir.x * rel.y - dir.y * rel.x;
}

export function clipConvexPolygonWithLine(poly, p0, p1, keepPositive) {
  const out = [];
  const eps = 1e-7;

  for (let i = 0; i < poly.length; i += 1) {
    const current = poly[i];
    const next = poly[(i + 1) % poly.length];
    const s1 = lineSideValue(current, p0, p1);
    const s2 = lineSideValue(next, p0, p1);
    const in1 = keepPositive ? s1 >= -eps : s1 <= eps;
    const in2 = keepPositive ? s2 >= -eps : s2 <= eps;

    if (in1 && in2) {
      out.push(next.clone());
      continue;
    }
    if (in1 && !in2) {
      const inter = segmentLineIntersection(current, next, p0, p1);
      if (inter) out.push(inter);
      continue;
    }
    if (!in1 && in2) {
      const inter = segmentLineIntersection(current, next, p0, p1);
      if (inter) out.push(inter);
      out.push(next.clone());
    }
  }

  return dedupeNearPoints(out, 1e-6);
}

function segmentLineIntersection(a, b, p0, p1) {
  const r = new THREE.Vector2().subVectors(b, a);
  const s = new THREE.Vector2().subVectors(p1, p0);
  const denom = cross2(r, s);
  if (Math.abs(denom) < 1e-8) return null;

  const qp = new THREE.Vector2().subVectors(p0, a);
  const t = cross2(qp, s) / denom;
  if (t < -1e-6 || t > 1 + 1e-6) return null;

  return new THREE.Vector2(a.x + r.x * t, a.y + r.y * t);
}

function cross2(v1, v2) {
  return v1.x * v2.y - v1.y * v2.x;
}

function dedupeNearPoints(points, eps) {
  if (points.length <= 1) return points;
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || prev.distanceToSquared(p) > eps * eps) out.push(p);
  }
  if (out.length > 2 && out[0].distanceToSquared(out[out.length - 1]) <= eps * eps) {
    out.pop();
  }
  return out;
}
