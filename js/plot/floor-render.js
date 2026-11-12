import { attached, envelope, itemBox, measure, openingPosition } from './floor-model.js';
import { resolveText } from './variables.js';

const NS = 'http://www.w3.org/2000/svg';
const palette = {
  blueprint: { background: '#10283d', grid: '#294861', ink: '#dbeefa', wall: '#c1dff0', room: '#18364e', accent: '#80e4ff', fixture: '#203f57', window: '#76cbf2' },
  furnished: { background: '#f6f3eb', grid: '#dfd9ca', ink: '#352d25', wall: '#453c33', room: '#eadfc7', accent: '#276984', fixture: '#dfc2a2', window: '#34829c' },
};
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
const line = (a, b, attrs = {}) => svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...attrs });
const rect = (x, y, width, height, attrs = {}) => svg('rect', { x, y, width, height, ...attrs });
const path = (d, attrs = {}) => svg('path', { d, ...attrs });
const polygon = (points, attrs = {}) => svg('polygon', { points: points.map(p => `${p.x},${p.y}`).join(' '), ...attrs });
const circle = (x, y, r, attrs = {}) => svg('circle', { cx: x, cy: y, r, ...attrs });
const text = (x, y, label, attrs = {}) => svg('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', ...attrs }, label);

function furniture(item, colors, fill) {
  const group = svg('g', { transform: `scale(${item.w / 100} ${item.h / 100})`, fill, stroke: colors.ink,
    'stroke-width': 1.3, 'stroke-linejoin': 'round' });
  const add = (...nodes) => group.append(...nodes);
  const outline = (x, y, w, h, radius = 3) => rect(x, y, w, h, { rx: radius });
  const detail = (x, y, w, h) => rect(x, y, w, h, { fill: colors.fixture, rx: 4 });
  switch (item.variant) {
    case 'bed':
      add(outline(-49, -49, 98, 98), detail(-42, -42, 39, 23), detail(3, -42, 39, 23),
        outline(-43, -13, 86, 56), path('M-43 1H43'));
      break;
    case 'couch':
      add(outline(-49, -49, 98, 98, 10), detail(-38, -39, 76, 22), outline(-37, -16, 37, 53),
        outline(0, -16, 37, 53), detail(-47, -36, 10, 73), detail(37, -36, 10, 73));
      break;
    case 'table':
      add(outline(-49, -49, 98, 98, 14), ...[-36, 36].flatMap(x => [-35, 35].map(y => circle(x, y, 4, { fill: colors.ink }))));
      break;
    case 'chair':
      add(outline(-45, -49, 90, 98, 14), detail(-42, -45, 84, 20), outline(-38, -18, 76, 56, 11));
      break;
    case 'desk':
      add(outline(-49, -49, 98, 98), detail(12, -44, 31, 87), path('M16 -15H38M16 15H38'), detail(-30, -25, 27, 18));
      break;
    case 'cabinet':
      add(outline(-49, -49, 98, 98), path('M0 -49V49M-7 -10V10M7 -10V10', { fill: 'none' }));
      break;
    case 'sink':
      add(outline(-49, -49, 98, 98, 8), detail(-37, -26, 74, 61), circle(0, 8, 4, { fill: colors.ink }), path('M0 -43V-17'));
      break;
  }
  return group;
}
function stairs(item, colors, fill) {
  const group = svg('g', { transform: `scale(${item.w / 100} ${item.h / 100})`, stroke: colors.ink, 'stroke-width': 1.2 });
  if (item.variant === 'straight') {
    group.append(rect(-50, -50, 100, 100, { fill }));
    for (let y = -40; y < 50; y += 10) group.append(path(`M-50 ${y}H50`));
    group.append(path('M0 42V-41M-8 -31L0 -41 8 -31', { fill: 'none', 'stroke-width': 2 }));
  } else {
    group.append(path('M-50 -50H-5V8H50V50H-50Z', { fill }));
    for (let y = -40; y < 8; y += 10) group.append(path(`M-50 ${y}H-5`));
    for (let x = -5; x < 50; x += 10) group.append(path(`M${x} 8V50`));
    group.append(path('M43 29H-28V-42M-35 -32L-28 -42 -21 -32', { fill: 'none', 'stroke-width': 2 }));
  }
  return group;
}

export function floorBounds(floor) {
  const walls = new Map(floor.objects.filter(item => item.type === 'wall').map(item => [item.id, item]));
  const bounds = envelope(floor.objects.flatMap(item => {
    const box = itemBox(item, floor, walls);
    return [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }];
  }));
  return { ...bounds, left: bounds.x, top: bounds.y, right: bounds.x + bounds.w, bottom: bounds.y + bounds.h,
    width: bounds.w, height: bounds.h };
}

export function drawFloor(plan, floor, box, { selected = new Set(), variables, zoom = 1, preview, marquee, interactive = false } = {}) {
  const colors = palette[plan.style], scale = 1 / zoom;
  const defs = svg('defs');
  const group = svg('g', { 'font-family': 'system-ui, sans-serif', fill: colors.ink }, defs);
  const background = rect(box.x, box.y, box.w, box.h, { fill: colors.background });
  group.append(background);
  if (plan.grid) {
    const gap = plan.spacing * 2 ** Math.max(0, Math.ceil(Math.log2(10 / (plan.spacing * zoom))));
    defs.append(svg('pattern', { id: 'floor-grid', width: gap, height: gap, patternUnits: 'userSpaceOnUse' },
      path(`M ${gap} 0 H0 V ${gap}`, { fill: 'none', stroke: colors.grid, 'stroke-width': scale })));
    group.append(rect(box.x, box.y, box.w, box.h, { fill: 'url(#floor-grid)', 'pointer-events': 'none' }));
  }
  defs.append(
    svg('pattern', { id: 'floor-wood', width: 24, height: 40, patternUnits: 'userSpaceOnUse' },
      path('M0 0V40M12 0V40M0 20H12M12 0H24', { fill: 'none', stroke: '#705534', opacity: .27 })),
    svg('pattern', { id: 'floor-tile', width: 24, height: 24, patternUnits: 'userSpaceOnUse' },
      path('M0 24V0H24', { fill: 'none', stroke: '#5c594c', opacity: .34 })),
  );
  const walls = new Map(), openings = new Map();
  const objects = { room: [], wall: [], door: [], window: [], shape: [], stairs: [], furniture: [], label: [] };
  for (const item of floor.objects) {
    objects[item.type].push(item);
    if (item.type === 'wall') walls.set(item.id, item);
    if (attached(item)) {
      if (!openings.has(item.wall)) openings.set(item.wall, []);
      openings.get(item.wall).push(item);
    }
  }
  const label = (x, y, value, size = 12, attrs = {}) => text(x, y, value,
    { 'font-size': size, 'pointer-events': 'none', fill: colors.ink, ...attrs });
  const outline = (item, attrs = {}) => svg('g', { 'data-plan-id': item.id, 'data-plan-type': item.type,
    'aria-label': item.name || item.type, ...attrs });
  const handled = [];
  const handle = (x, y, type, item, vertex) => {
    const attrs = { fill: colors.background, stroke: colors.accent, 'stroke-width': 2 * scale,
      'data-plan-handle': type, 'data-plan-id': item.id, ...(vertex ? { 'data-vertex': vertex } : {}) };
    handled.push(type === 'rotate' ? circle(x, y, 5 * scale, attrs) : rect(x - 4 * scale, y - 4 * scale, 8 * scale, 8 * scale, attrs));
  };
  const single = selected.size === 1;
  const selectionLine = { fill: 'none', stroke: colors.accent, 'stroke-width': 1.5 * scale, 'pointer-events': 'none' };

  for (const room of objects.room) {
    const node = outline(room), points = room.vertices.map(v => floor.points[v]), bounds = envelope(points);
    node.append(polygon(points, { fill: plan.style === 'furnished' ? room.color : colors.room,
      stroke: selected.has(room.id) ? colors.accent : colors.grid, 'stroke-width': 2 * scale }));
    if (plan.style === 'furnished' && room.surface !== 'plain') node.append(polygon(points, { fill: `url(#floor-${room.surface})`, 'pointer-events': 'none' }));
    if (selected.has(room.id) && single) {
      for (const vertex of room.vertices) handle(floor.points[vertex].x, floor.points[vertex].y, 'vertex', room, vertex);
      handle(bounds.x + bounds.w + 13 * scale, bounds.y + bounds.h + 13 * scale, 'room-size', room);
    }
    group.append(node);
  }
  for (const wall of objects.wall) {
    const a = floor.points[wall.a], b = floor.points[wall.b], length = Math.hypot(b.x - a.x, b.y - a.y);
    const node = outline(wall), gaps = (openings.get(wall.id) ?? []).map(item => {
      const pos = openingPosition(item, floor, walls);
      return [pos.at - pos.width / (2 * length), pos.at + pos.width / (2 * length)];
    }).sort((one, two) => one[0] - two[0]);
    const color = selected.has(wall.id) ? colors.accent : colors.wall;
    const at = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    let start = 0;
    for (const [low, high] of [...gaps, [1, 1]]) {
      if (low > start) node.append(line(at(start), at(low), { stroke: color, 'stroke-width': wall.thickness }));
      start = Math.max(start, high);
    }
    if (interactive) node.append(line(a, b, { stroke: 'transparent', 'stroke-width': Math.max(wall.thickness, 15 * scale) }));
    if (selected.has(wall.id) && single) {
      handle(a.x, a.y, 'vertex', wall, wall.a);
      handle(b.x, b.y, 'vertex', wall, wall.b);
    }
    group.append(node);
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const midpoint = at(.5);
    const readableAngle = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
    const annotation = label(0, -wall.thickness / 2 - 12, measure(length, plan.unit), 11, {
      stroke: colors.background, 'stroke-width': 3, 'paint-order': 'stroke',
    });
    group.append(svg('g', { transform: `translate(${midpoint.x} ${midpoint.y}) rotate(${readableAngle})` }, annotation));
  }

  for (const item of [...objects.door, ...objects.window]) {
    const p = openingPosition(item, floor, walls), half = p.width / 2;
    const node = outline(item, { transform: `translate(${p.x} ${p.y}) rotate(${p.angle})` });
    if (item.type === 'window') {
      const height = Math.max(5, p.thickness * .75);
      node.append(rect(-half, -height / 2, p.width, height, { fill: colors.background, stroke: colors.window, 'stroke-width': 2 }),
        path(`M${-half} 0H${half}`, { stroke: colors.window, 'stroke-width': 1.4 }));
    } else {
      const dir = item.swing.endsWith('in') ? 1 : -1;
      const leaf = (pivot, sign, width) => path(
        `M${pivot} 0v${dir * width}a${width} ${width} 0 0 ${sign * dir === 1 ? 0 : 1} ${sign * width} ${-dir * width}`,
        { fill: 'none', stroke: colors.ink, 'stroke-width': 1.6 },
      );
      node.append(leaf(item.swing.startsWith('left') || item.variant === 'double' ? -half : half,
        item.swing.startsWith('left') || item.variant === 'double' ? 1 : -1, item.variant === 'double' ? half : p.width));
      if (item.variant === 'double') node.append(leaf(half, -1, half));
      node.append(path(`M${-half} 0H${half}`, { stroke: colors.ink, 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    }
    const hitHeight = item.type === 'door' ? (item.variant === 'double' ? half : p.width) : p.thickness / 2;
    const top = item.type === 'door' && item.swing.endsWith('in') ? -7 * scale : -hitHeight;
    if (interactive) node.append(rect(-half, top, p.width, hitHeight + 7 * scale, { fill: 'transparent' }));
    if (selected.has(item.id)) {
      node.append(rect(-half, -8 * scale, p.width, 16 * scale, selectionLine));
      if (single) {
        const radians = p.angle * Math.PI / 180;
        handle(p.x + Math.cos(radians) * half, p.y + Math.sin(radians) * half, 'opening-size', item);
      }
    }
    group.append(node);
  }

  for (const room of objects.room) {
    const bounds = itemBox(room, floor);
    const x = bounds.x + bounds.w / 2, y = bounds.y + bounds.h / 2;
    const opts = { stroke: plan.style === 'blueprint' ? colors.room : room.color, 'stroke-width': 3, 'paint-order': 'stroke' };
    group.append(label(x, y - 9, resolveText(room.name, variables), 16, { ...opts, 'font-weight': 650 }),
      label(x, y + 10, `${measure(bounds.w, plan.unit)} × ${measure(bounds.h, plan.unit)}`, 11, opts));
  }
  for (const item of [...objects.shape, ...objects.stairs, ...objects.furniture, ...objects.label]) {
    const { x, y, w, h, angle } = item, node = outline(item, { transform: `translate(${x} ${y}) rotate(${angle})` });
    const fill = plan.style === 'furnished' ? item.color : colors.fixture;
    if (item.type === 'furniture') node.append(furniture(item, colors, fill));
    if (item.type === 'stairs') node.append(stairs(item, colors, fill));
    if (item.type === 'shape') {
      const attrs = { fill, stroke: colors.ink, 'stroke-width': 1.5 };
      node.append(item.variant === 'circle' ? svg('ellipse', { rx: w / 2, ry: h / 2, ...attrs }) :
        item.variant === 'triangle' ? polygon([{ x: 0, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }], attrs) :
          rect(-w / 2, -h / 2, w, h, attrs));
    }
    if (item.type === 'label') {
      const value = resolveText(item.name, variables);
      const size = Math.min(h * .62, w / Math.max(1, value.length * .57));
      node.append(label(0, 0, value, size, { fill: plan.style === 'furnished' ? item.color : colors.ink }));
      if (interactive) node.append(rect(-w / 2, -h / 2, w, h, { fill: 'transparent' }));
    }
    if (selected.has(item.id)) {
      node.append(rect(-w / 2, -h / 2, w, h, selectionLine));
      if (single) {
        const rad = angle * Math.PI / 180, turn = (a, b) => ({
          x: x + a * Math.cos(rad) - b * Math.sin(rad), y: y + a * Math.sin(rad) + b * Math.cos(rad),
        });
        const corner = turn(w / 2, h / 2), grip = turn(0, -h / 2 - 20 * scale);
        node.append(path(`M0 ${-h / 2}v${-20 * scale}`, selectionLine));
        handle(corner.x, corner.y, 'size', item);
        handle(grip.x, grip.y, 'rotate', item);
      }
    }
    group.append(node);
  }
  if (preview?.length) {
    const pts = preview.map(p => `${p.x},${p.y}`).join(' ');
    group.append(svg(preview.closed ? 'polygon' : 'polyline', { points: pts, fill: preview.closed ? colors.accent + '30' : 'none',
      stroke: colors.accent, 'stroke-width': 2 * scale, 'stroke-dasharray': `${6 * scale} ${4 * scale}`, 'pointer-events': 'none' }));
    if (preview.length === 2) {
      const [a, b] = preview;
      group.append(label((a.x + b.x) / 2, (a.y + b.y) / 2 - 13 * scale, measure(Math.hypot(b.x - a.x, b.y - a.y), plan.unit)));
    }
    for (const p of preview) group.append(circle(p.x, p.y, 3 * scale, { fill: colors.accent, 'pointer-events': 'none' }));
  }
  if (marquee) group.append(rect(marquee.x, marquee.y, marquee.w, marquee.h,
    { ...selectionLine, fill: colors.accent + '22', 'stroke-dasharray': `${4 * scale} ${3 * scale}` }));
  group.append(...handled);
  return group;
}
