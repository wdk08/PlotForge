import { furnitureDefinition } from './furniture-catalog.js';
import { FURNITURE_COLOR } from './furniture-data.js';

// Floor geometry uses centimeters so changing the display unit never rescales a plan.
export const FLOOR_UNITS = { ft: 30.48, in: 2.54, m: 100, cm: 1 };
export const PLAN_LIMIT = 1_000_000;
export const FLOOR_ITEMS = {
  door: { single: 'Single door', double: 'Double door' },
  window: { window: 'Window' },
  stairs: { straight: 'Straight stairs', corner: 'L-shaped stairs' },
  shape: { rectangle: 'Rectangle', circle: 'Circle', triangle: 'Triangle' },
  label: { text: 'Text label' },
};
export const FLOOR_NAMES = { wall: 'Wall', room: 'Room', door: 'Door', window: 'Window', stairs: 'Stairs', furniture: 'Furniture', shape: 'Shape', label: 'Text label' };
const dimensions = {
  straight: [95, 280], corner: [200, 250],
  rectangle: [100, 65], circle: [80, 80], triangle: [90, 80], text: [140, 34],
};
const key = () => crypto.randomUUID();
export const limit = value => Math.max(-PLAN_LIMIT, Math.min(PLAN_LIMIT, value));
export const xy = (x, y) => ({ x: limit(x), y: limit(y) });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const activeFloor = plan => plan.floors.find(floor => floor.id === plan.active);
export const makeFloor = name => ({ id: key(), name, points: {}, objects: [] });
export const makePlan = () => {
  const floor = makeFloor('Ground floor');
  return { active: floor.id, floors: [floor], style: 'blueprint', unit: 'ft', grid: true, snap: true, wallSnap: true, spacing: 30.48 };
};
export const updateFloor = (plan, floor) => ({ ...plan, floors: plan.floors.map(current => current.id === floor.id ? floor : current) });
export const attached = item => item.type === 'door' || item.type === 'window';
export const verticesOf = item => item.type === 'wall' ? [item.a, item.b] : item.type === 'room' ? item.vertices : [];
export const amount = (cm, unit) => Number((cm / FLOOR_UNITS[unit]).toFixed(4));
export const measure = (cm, unit) => `${Number((cm / FLOOR_UNITS[unit]).toFixed(2))} ${unit}`;

export function envelope(points) {
  if (!points.length) return { x: 0, y: 0, w: 450, h: 300 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x); top = Math.min(top, p.y);
    right = Math.max(right, p.x); bottom = Math.max(bottom, p.y);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
export function projection(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, length = distance(a, b);
  const at = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length ** 2)) : 0;
  return { x: a.x + at * dx, y: a.y + at * dy, at, length, angle: Math.atan2(dy, dx) * 180 / Math.PI };
}
export function nearestWall(floor, p, radius, except = new Set()) {
  let nearest, best = radius;
  for (const wall of floor.objects) {
    if (wall.type !== 'wall' || except.has(wall.a) || except.has(wall.b)) continue;
    const hit = projection(p, floor.points[wall.a], floor.points[wall.b]), gap = distance(p, hit);
    if (gap <= best) { nearest = { ...hit, wall: wall.id }; best = gap; }
  }
  return nearest;
}
export function snapPoint(plan, floor, p, radius, except = new Set(), wallSnap = true) {
  if (wallSnap && plan.wallSnap) {
    let near, best = radius;
    for (const [vertex, pos] of Object.entries(floor.points)) {
      if (except.has(vertex)) continue;
      const gap = distance(p, pos);
      if (gap <= best) { best = gap; near = { ...pos, vertex }; }
    }
    if (near) return near;
    const hit = nearestWall(floor, p, radius, except);
    if (hit) return hit;
  }
  const spacing = plan.spacing;
  return plan.snap ? xy(Math.round(p.x / spacing) * spacing, Math.round(p.y / spacing) * spacing) : xy(p.x, p.y);
}

export function openingPosition(item, floor, walls = new Map(floor.objects.filter(object => object.type === 'wall').map(wall => [wall.id, wall]))) {
  const wall = walls.get(item.wall);
  const a = floor.points[wall.a], b = floor.points[wall.b], length = distance(a, b);
  const width = Math.min(item.width, length);
  const margin = length ? width / (2 * length) : .5;
  const at = Math.max(margin, Math.min(1 - margin, item.at));
  return { x: a.x + at * (b.x - a.x), y: a.y + at * (b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI,
    width, thickness: wall.thickness, at, length };
}
export function itemBox(item, floor, walls) {
  const vertices = verticesOf(item);
  if (vertices.length) {
    const bounds = envelope(vertices.map(vertex => floor.points[vertex]));
    if (item.type === 'wall') return { x: bounds.x - item.thickness / 2, y: bounds.y - item.thickness / 2,
      w: bounds.w + item.thickness, h: bounds.h + item.thickness };
    return bounds;
  }
  const placed = attached(item) ? openingPosition(item, floor, walls) : item;
  const { x, y, angle } = placed, radians = angle * Math.PI / 180;
  const w = placed.w ?? placed.width, h = placed.h ?? (item.type === 'door' ? placed.width * 2 : placed.thickness);
  const halfW = (Math.abs(Math.cos(radians)) * w + Math.abs(Math.sin(radians)) * h) / 2;
  const halfH = (Math.abs(Math.sin(radians)) * w + Math.abs(Math.cos(radians)) * h) / 2;
  return { x: x - halfW, y: y - halfH, w: halfW * 2, h: halfH * 2 };
}

function resolveVertex(draft, p) {
  if (p.vertex && draft.points[p.vertex]) return p.vertex;
  const existing = Object.keys(draft.points).find(id => distance(p, draft.points[id]) < .01);
  if (existing) return existing;
  const vertex = key();
  draft.points[vertex] = xy(p.x, p.y);
  // Split a snapped wall at the new joint and preserve the openings and room outline.
  if (p.wall) {
    const wall = draft.objects.find(item => item.id === p.wall &&
      distance(p, projection(p, draft.points[item.a], draft.points[item.b])) < .01) ??
      draft.objects.find(item => item.type === 'wall' && distance(p, projection(p, draft.points[item.a], draft.points[item.b])) < .01);
    if (wall) {
      const hit = projection(p, draft.points[wall.a], draft.points[wall.b]);
      const crossesOpening = draft.objects.some(item => attached(item) && item.wall === wall.id &&
        Math.abs(openingPosition(item, draft).at - hit.at) * hit.length < item.width / 2 + 1);
      if (hit.at > .001 && hit.at < .999 && !crossesOpening) {
        const second = { ...wall, id: key(), a: vertex };
        draft.objects = draft.objects.map(item => {
          if (item.id === wall.id) return { ...wall, b: vertex };
          if (attached(item) && item.wall === wall.id) {
            const { at } = openingPosition(item, draft);
            return at < hit.at ? { ...item, at: at / hit.at } :
              { ...item, wall: second.id, at: (at - hit.at) / (1 - hit.at) };
          }
          if (item.type !== 'room') return item;
          return { ...item, vertices: item.vertices.flatMap((v, i) => {
            const next = item.vertices[(i + 1) % item.vertices.length];
            return (v === wall.a && next === wall.b || v === wall.b && next === wall.a) ? [v, vertex] : [v];
          }) };
        });
        draft.objects.push(second);
      }
    }
  }
  return vertex;
}

const copyFloor = floor => ({ ...floor, points: { ...floor.points }, objects: [...floor.objects] });
function addEdge(floor, a, b, thickness) {
  if (a === b || distance(floor.points[a], floor.points[b]) < 1) return;
  const existing = floor.objects.find(item => item.type === 'wall' && (item.a === a && item.b === b || item.a === b && item.b === a));
  if (existing) return existing;
  const wall = { id: key(), type: 'wall', a, b, thickness };
  floor.objects.push(wall);
  return wall;
}
function intermediateVertices(floor, a, b) {
  const start = floor.points[a], end = floor.points[b];
  return Object.entries(floor.points).flatMap(([id, p]) => {
    if (id === a || id === b) return [];
    const hit = projection(p, start, end);
    return hit.at > 0 && hit.at < 1 && distance(p, hit) < .01 ? [{ id, at: hit.at }] : [];
  }).sort((first, last) => first.at - last.at).map(point => point.id);
}

export function drawWall(floor, from, to, thickness = 15) {
  if (distance(from, to) < 1) return;
  const next = copyFloor(floor);
  const a = resolveVertex(next, from), b = resolveVertex(next, to);
  const vertices = [a, ...intermediateVertices(next, a, b), b];
  for (let i = 1; i < vertices.length; i++) addEdge(next, vertices[i - 1], vertices[i], thickness);
  return { floor: next, end: { ...next.points[b], vertex: b } };
}
function simpleRoom(points) {
  const area = points.reduce((total, a, i) => {
    const b = points[(i + 1) % points.length];
    return total + a.x * b.y - a.y * b.x;
  }, 0);
  if (Math.abs(area) < 2) return false;
  const side = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a, b, c) => Math.abs(side(a, b, c)) < 1e-6 && c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) &&
    c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (distance(a, b) < 1) return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j], d = points[(j + 1) % points.length];
      if (on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b) ||
          side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return false;
    }
  }
  return true;
}
export function drawRoom(floor, points, thickness = 15) {
  if (points.length < 3 || !simpleRoom(points)) return;
  const next = copyFloor(floor);
  const corners = points.map(p => resolveVertex(next, p));
  const vertices = corners.flatMap((vertex, i) => [vertex, ...intermediateVertices(next, vertex, corners[(i + 1) % corners.length])]);
  if (new Set(vertices).size !== vertices.length) return;
  const room = { id: key(), type: 'room', vertices, name: 'Room', color: '#e9d9bd', surface: 'plain' };
  vertices.forEach((a, i) => addEdge(next, a, vertices[(i + 1) % vertices.length], thickness));
  next.objects.push(room);
  return { floor: next, item: room };
}
export function makeFloorItem(type, variant, p) {
  if (type === 'furniture') {
    const definition = typeof variant === 'string' ? furnitureDefinition(variant) : variant;
    return { id: key(), type, variant: definition.design ? 'custom' : definition.id, x: p.x, y: p.y,
      w: definition.w, h: definition.h, name: definition.name, angle: 0, color: FURNITURE_COLOR,
      ...(definition.design && { design: structuredClone(definition.design) }) };
  }
  const [w, h] = dimensions[variant];
  return { id: key(), type, variant, x: p.x, y: p.y, w, h, angle: 0,
    name: type === 'label' ? 'Label' : FLOOR_ITEMS[type][variant], color: type === 'label' ? '#3e382d' : '#af8b62' };
}
export function makeOpening(type, variant, hit) {
  return { id: key(), type, variant, wall: hit.wall, at: hit.at,
    width: Math.min(hit.length, variant === 'double' ? 160 : type === 'door' ? 90 : 110), swing: 'left-in' };
}
export function replaceItem(floor, item) {
  return { ...floor, objects: floor.objects.map(current => current.id === item.id ? item : current) };
}

export function changePoints(floor, changes) {
  const points = { ...floor.points, ...changes };
  for (const item of floor.objects) {
    if (item.type === 'wall' && distance(points[item.a], points[item.b]) < 1) return floor;
    if (item.type === 'room' && item.vertices.some(v => Object.hasOwn(changes, v)) &&
        !simpleRoom(item.vertices.map(v => points[v]))) return floor;
  }
  return { ...floor, points };
}
export function translateFloorItems(floor, selected, dx, dy) {
  const moving = floor.objects.filter(item => selected.has(item.id));
  const vertices = new Set(moving.flatMap(verticesOf));
  const next = changePoints(floor, Object.fromEntries([...vertices].map(id => [id, xy(floor.points[id].x + dx, floor.points[id].y + dy)])));
  if (vertices.size && next === floor) return floor;
  const walls = new Map(floor.objects.filter(item => item.type === 'wall').map(wall => [wall.id, wall]));
  return { ...next, objects: next.objects.map(item => {
    if (!selected.has(item.id) || verticesOf(item).length) return item;
    if (!attached(item)) return { ...item, ...xy(item.x + dx, item.y + dy) };
    const wall = walls.get(item.wall);
    if (vertices.has(wall.a) || vertices.has(wall.b)) return item;
    const pos = openingPosition(item, floor, walls);
    return { ...item, at: projection({ x: pos.x + dx, y: pos.y + dy }, floor.points[wall.a], floor.points[wall.b]).at };
  }) };
}
export function resizeRoom(floor, item, width, height) {
  const box = itemBox(item, floor);
  return changePoints(floor, Object.fromEntries(item.vertices.map(id => {
    const p = floor.points[id];
    return [id, xy(box.x + (p.x - box.x) * width / box.w, box.y + (p.y - box.y) * height / box.h)];
  })));
}
export function deleteFloorItems(floor, ids) {
  const objects = floor.objects.filter(item => !ids.has(item.id) && !(attached(item) && ids.has(item.wall)));
  const used = new Set(objects.flatMap(verticesOf));
  return { ...floor, objects, points: Object.fromEntries(Object.entries(floor.points).filter(([id]) => used.has(id))) };
}
