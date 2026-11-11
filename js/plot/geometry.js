import { clamp, point, WORLD } from './model.js';

export const MIN_ZOOM = 0.00001;
export const MAX_ZOOM = 6;
export const worldAt = (view, x, y) => ({ x: (x - view.x) / view.zoom, y: (y - view.y) / view.zoom });
export function zoomAt(view, x, y, zoom) {
  const anchor = worldAt(view, x, y);
  zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return { x: clamp(x - anchor.x * zoom, -WORLD * 10, WORLD * 10), y: clamp(y - anchor.y * zoom, -WORLD * 10, WORLD * 10), zoom };
}
export const center = element => ({ x: element.x + element.w / 2, y: element.y + element.h / 2 });
export function bounds(element) {
  const { x, y, w, h, angle = 0 } = element;
  if (!angle) return { left: x, top: y, right: x + w, bottom: y + h };
  const radians = angle * Math.PI / 180;
  const width = Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians));
  const height = Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians));
  const mid = center(element);
  return { left: mid.x - width / 2, top: mid.y - height / 2, right: mid.x + width / 2, bottom: mid.y + height / 2 };
}

export function boardBounds(elements, padding = 0) {
  if (!elements.length) return { left: 0, top: 0, right: 600, bottom: 360, width: 600, height: 360 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const element of elements) {
    const box = bounds(element);
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  return { left: left - padding, top: top - padding, right: right + padding, bottom: bottom + padding,
    width: right - left + padding * 2, height: bottom - top + padding * 2 };
}

export const intersects = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
export function viewportBounds(view, width, height, margin = 220) {
  const start = worldAt(view, -margin, -margin);
  const end = worldAt(view, width + margin, height + margin);
  return { left: start.x, top: start.y, right: end.x, bottom: end.y };
}
export function fitView(elements, width, height) {
  if (!elements.length) return { x: 0, y: 0, zoom: 1 };
  const box = boardBounds(elements, 36);
  const zoom = clamp(Math.min(width / box.width, height / box.height, 1.5), MIN_ZOOM, MAX_ZOOM);
  return { x: width / 2 - (box.left + box.width / 2) * zoom, y: height / 2 - (box.top + box.height / 2) * zoom, zoom };
}

function anchor(element, towards) {
  const mid = center(element);
  const angle = (element.angle ?? 0) * Math.PI / 180;
  const dx = towards.x - mid.x, dy = towards.y - mid.y;
  const x = dx * Math.cos(angle) + dy * Math.sin(angle);
  const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const ratio = element.shape === 'ellipse' ? Math.hypot(x / (element.w / 2), y / (element.h / 2))
    : Math.max(Math.abs(x) / (element.w / 2), Math.abs(y) / (element.h / 2));
  return ratio ? { x: mid.x + dx / ratio, y: mid.y + dy / ratio } : mid;
}

export const endpoints = (from, to) => [anchor(from, center(to)), anchor(to, center(from))];
const stops = (start, end) => [start, (start + end) / 2, end];
function nearest(source, targets, delta, tolerance) {
  let distance = tolerance, snap;
  for (const other of targets) for (const own of source) {
    const offset = other - own - delta;
    if (Math.abs(offset) < distance) { distance = Math.abs(offset); snap = { offset, line: other }; }
  }
  return snap;
}
export function snapMove(moving, others, dx, dy, zoom) {
  const group = boardBounds(moving);
  const targets = others.map(bounds);
  const x = nearest(stops(group.left, group.right), targets.flatMap(box => stops(box.left, box.right)), dx, 7 / zoom);
  const y = nearest(stops(group.top, group.bottom), targets.flatMap(box => stops(box.top, box.bottom)), dy, 7 / zoom);
  return { dx: dx + (x?.offset ?? 0), dy: dy + (y?.offset ?? 0), x: x?.line, y: y?.line };
}

export function resizeElement(element, dx, dy, free = false) {
  const angle = (element.angle ?? 0) * Math.PI / 180;
  const width = clamp(element.w + dx * Math.cos(angle) + dy * Math.sin(angle), 48, WORLD);
  const height = clamp(element.h - dx * Math.sin(angle) + dy * Math.cos(angle), 32, WORLD);
  const ratio = !free && ['image', 'video'].includes(element.type) ? element.ratio ?? element.w / element.h : null;
  const minimumHeight = ratio ? Math.max(32, 48 / ratio) : 32;
  const maximumHeight = ratio ? Math.min(WORLD, WORLD / ratio) : WORLD;
  const projected = ratio ? (width * ratio + height) / (ratio ** 2 + 1) : height;
  const h = clamp(projected, minimumHeight, maximumHeight);
  const w = ratio ? h * ratio : width;
  const shiftX = (w - element.w) / 2, shiftY = (h - element.h) / 2;
  return { ...element, w, h,
    x: point(element.x + shiftX * Math.cos(angle) - shiftY * Math.sin(angle) - shiftX),
    y: point(element.y + shiftX * Math.sin(angle) + shiftY * Math.cos(angle) - shiftY) };
}
