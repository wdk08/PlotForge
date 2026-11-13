import { furnitureDefinition } from './furniture-catalog.js';

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
const rect = (x, y, width, height, rx = 3, attrs = {}) => svg('rect', { x, y, width, height, rx, ...attrs });
const circle = (cx, cy, r, attrs = {}) => svg('circle', { cx, cy, r, ...attrs });
const ellipse = (cx, cy, rx, ry, attrs = {}) => svg('ellipse', { cx, cy, rx, ry, ...attrs });
const path = (d, attrs = {}) => svg('path', { d, fill: 'none', ...attrs });

export const furniturePreviewColors = { ink: '#453b31', fixture: '#efe0c9' };
export function drawSymbol(variant, w, h, colors, fill) {
  const { symbol, detail } = furnitureDefinition(variant);
  const g = svg('g', { transform: `scale(${w / 100} ${h / 100})`, fill, stroke: colors.ink,
    'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  const add = (...nodes) => g.append(...nodes);
  const body = (r = 4) => rect(-48, -48, 96, 96, r);
  const inset = (x, y, width, height, r = 4) => rect(x, y, width, height, r, { fill: colors.fixture });
  const mark = (x, y, r = 2) => circle(x, y, r, { fill: colors.ink, stroke: 'none' });
  const bars = (start, end, step, shape) => Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => path(shape(start + i * step)));
  switch (symbol) {
    case 'bed':
      add(body(), path('M-46 -47H46V-37H-46Z', { fill: colors.fixture }));
      if (detail === 'crib') {
        add(inset(-37, -34, 74, 70, 12), ...bars(-32, 32, 8, y => `M-48 ${y}h10m76 0h10`), ellipse(0, -16, 15, 9));
      } else {
        const pillows = detail === 2 ? [inset(-39, -31, 35, 20), inset(4, -31, 35, 20)] : [inset(-26, -31, 52, 20)];
        add(...pillows, rect(-40, -8, 80, 49), path('M-39 3H39'));
        if (detail === 'bunk') add(...bars(9, 43, 8, y => `M32 ${y}h15`), path('M32 7v38M47 7v38'));
      }
      break;
    case 'seat': {
      if (detail === 'ottoman') { add(body(18), inset(-40, -40, 80, 80, 15), ...[-15, 15].flatMap(x => [-15, 15].map(y => mark(x, y)))); break; }
      const sectional = detail === 'sectional';
      add(sectional ? path('M-48 -48H48V48H12V10H-48Z', { fill }) : body(10),
        inset(-35, -41, 70, 22), inset(-45, -37, 10, sectional ? 47 : 78), inset(35, -37, 10, 78));
      const seats = typeof detail === 'number' ? detail : sectional ? 3 : 1;
      for (let i = 0; i < seats; i++) add(rect(-34 + 68 * i / seats, -17, 68 / seats - 1, sectional ? 25 : 55, 5));
      if (sectional) add(rect(14, 10, 20, 34, 4));
      if (detail === 'recliner') add(inset(-24, 23, 48, 23, 6));
      break;
    }
    case 'table':
      add(['round', 'oval', 'patio'].includes(detail) ? ellipse(0, 0, 48, 48) : body(12));
      if (detail === 'patio') add(mark(0, 0, 7), ...bars(-28, 28, 14, y => `M-34 ${y}h68`));
      else add(...[-28, 28].flatMap(x => [-27, 27].map(y => mark(x, y, 3))));
      if (detail === 'oval') add(ellipse(0, 0, 41, 41, { fill: 'none' }));
      break;
    case 'chair':
      if (detail === 'stool') add(circle(0, 0, 46), circle(0, 0, 29, { fill: colors.fixture }), ...[0, 120, 240].map(angle => path('M0 29v15', { transform: `rotate(${angle})` })));
      else {
        add(body(13), inset(-40, -43, 80, detail === 'lounge' ? 32 : 22), rect(-37, -18, 74, 59, 10));
        if (detail === 'slats' || detail === 'lounge') add(...bars(-8, 34, 9, y => `M-32 ${y}h64`));
        if (detail === 'office') add(inset(-49, -14, 10, 45), inset(39, -14, 10, 45), path('M-22 44L0 32l22 12'));
      }
      break;
    case 'desk':
      add(detail === 'corner' ? path('M-48 -48H48V48H12V-2H-48Z', { fill }) : body());
      if (detail === 'vanity') add(inset(-35, -43, 70, 12), ellipse(0, 17, 20, 16), mark(0, 17));
      else if (detail === 'computer') add(inset(-30, -36, 60, 15), path('M0 -21v12m-12 0h24'), inset(-30, 0, 53, 16), ellipse(32, 8, 7, 11));
      else add(inset(17, -44, 26, detail === 'corner' ? 85 : 87), path('M19 -16H41M19 15H41'), inset(-35, -32, 33, 20));
      break;
    case 'drawers':
      add(body(), ...Array.from({ length: detail }, (_, i) => {
        const w = 84 / detail;
        return svg('g', {}, inset(-42 + i * w, 4, w, 38, 2), path(`M${-42 + (i + .5) * w - 5} 28h10`));
      }), path('M-41 -33h82'));
      break;
    case 'cabinet':
      add(body());
      if (['books', 'shelves'].includes(detail)) {
        add(...bars(-32, 33, 12, y => `M-44 ${y}h88`));
        if (detail === 'books') add(...bars(-34, 35, 8, x => `M${x} -31v10m0 14v10m0 14v10`));
      } else if (['tv', 'media'].includes(detail)) {
        add(inset(detail === 'media' ? -29 : -38, -31, detail === 'media' ? 58 : 76, 21), path('M0 -10v23m-18 0h36'));
        if (detail === 'media') add(inset(-45, -36, 12, 72), inset(33, -36, 12, 72));
      } else {
        add(path('M0 -47V47M-7 -10V10M7 -10V10'));
        if (detail === 'wardrobe') add(path('M-39 -31H39M-39 31H39'));
        if (detail === 'upper') add(path('M-43 36h86', { 'stroke-dasharray': '4 3' }));
        if (detail === 'lower') add(path('M-43 -35h86'));
      }
      break;
    case 'toilet':
      add(rect(-47, -48, 94, 30, 7), ellipse(0, 12, 38, 35), ellipse(0, 12, 26, 24, { fill: colors.fixture }), mark(0, -33, 4));
      break;
    case 'basin': {
      add(detail === 'pedestal' ? ellipse(0, 0, 48, 47) : body(detail === 'wall' ? 17 : 4));
      const centers = detail === 'double' ? [-24, 24] : [0];
      for (const x of centers) add(inset(x - (centers.length === 2 ? 19 : 33), -13, centers.length === 2 ? 38 : 66, 47, detail === 'utility' ? 3 : 13),
        mark(x, 12, 4), path(`M${x} -35v22`));
      if (detail === 'pedestal') add(path('M-14 36h28'));
      if (detail === 'wall') add(path('M-37 -42h74', { 'stroke-dasharray': '4 3' }));
      break;
    }
    case 'bath':
      if (detail === 'corner') add(path('M-48 -48H48A96 96 0 0 1 -48 48Z', { fill }),
        path('M-36 -36H30A74 74 0 0 1 -36 30Z', { fill: colors.fixture }), mark(-25, -25, 4));
      else {
        add(body(detail === 'shower' ? 2 : 14), inset(-38, -39, 76, 78, detail === 'shower' ? 2 : 24), mark(0, 25, 5));
        if (detail === 'shower' || detail === 'combo') add(path('M-35 -22h70M-28 -32v-10m0 0h16', { 'stroke-dasharray': detail === 'combo' ? '4 3' : 'none' }));
        if (detail === 'shower') add(path('M-37 38L0 25 37 38M-37 -38L0 25 37 -38'));
      }
      break;
    case 'appliance':
      add(body(5));
      if (detail === 'stove' || detail === 'grill') {
        if (detail === 'stove') add(...[-22, 22].flatMap(x => [-24, 19].map(y => circle(x, y, 14, { fill: colors.fixture }))));
        else add(inset(-41, -40, 65, 80), ...bars(-30, 33, 10, x => `M${x} -35v70`));
        add(path('M-39 39H39'), mark(-25, 43), mark(-12, 43), mark(1, 43));
      } else if (['washer', 'dryer', 'stacked'].includes(detail)) {
        const centers = detail === 'stacked' ? [-18, 21] : [4];
        add(path('M-43 -39h86'), mark(31, -44));
        for (const y of centers) add(circle(0, y, centers.length === 2 ? 16 : 32, { fill: colors.fixture }),
          detail === 'dryer' ? path(`M-20 ${y}q10 -10 20 0t20 0`) : path(`M-10 ${y + 5}q10 -9 20 0`));
      } else if (detail === 'fridge') add(path('M0 -45v90m-8 -26v25m16 -25v25M-46 34H46'));
      else {
        add(inset(-40, -36, detail === 'microwave' ? 56 : 80, 61), path('M-35 35h70'), mark(34, 37, 3));
        if (detail === 'dishwasher') add(...bars(-30, 30, 12, x => `M${x} -24v38`));
        if (detail === 'oven') add(path('M-31 -19h62m-62 17h62m-62 17h62'));
        if (detail === 'microwave') add(mark(31, -23), mark(31, -9), mark(31, 7));
      }
      break;
    case 'counter':
      add(body(), path('M-43 -36h86M-43 36h86'));
      if (detail === 'island') add(path('M-26 34v-68m52 0v68M-8 5h16'));
      break;
    case 'fire':
      add(detail === 'pit' ? circle(0, 0, 48) : body(), detail === 'pit' ? circle(0, 0, 34, { fill: colors.fixture }) : inset(-35, -29, 70, 63),
        path('M0 25C-27 15 -24 -2 -12 -10q-3 17 10 12Q10 -10 3 -26q32 25 16 45Q13 26 0 25Z', { fill }));
      break;
    case 'mirror':
      add(rect(-48, -30, 96, 60, 16), path('M-35 13l25 -26m0 27l27 -27m0 26l18 -18'));
      break;
    case 'rack':
      add(rect(-47, -34, 94, 68, 5), path('M-44 -13h88M-44 12h88'), inset(-29, -18, 36, 57));
      break;
    case 'ironing':
      add(path('M-42 46V-15Q-42 -37 0 -48Q42 -37 42 -15V46Z', { fill }), path('M-31 30h62m-55 9h48'), mark(0, -22, 5));
      break;
    case 'planter':
      add(body(9), inset(-38, -36, 76, 72), ...[-22, 18].flatMap(x => [circle(x, 4, 14), ellipse(x - 5, -12, 7, 16), ellipse(x + 7, 16, 7, 13)]));
      break;
    case 'piano':
      add(path('M-48 48V-44Q46 -61 48 -5V48Z', { fill }), inset(-42, 25, 84, 19),
        ...bars(-38, 38, 6, x => `M${x} 25v19`), path('M-40 -31Q34 -40 38 -6L-40 15Z'));
      break;
    case 'pool':
      add(body(9), inset(-39, -36, 78, 72), ...[-39, 0, 39].flatMap(x => [-36, 36].map(y => mark(x, y, 4))),
        path('M3 -10l17 10-17 10Z'), mark(-16, 4, 3));
      break;
    case 'exercise':
      add(body(7), inset(-32, -30, 64, 70), path('M-43 10v-49h86v49M-28 -22h56'), rect(-21, -46, 42, 14, 3));
      break;
  }
  return g;
}

export function drawPart(part, colors, blueprint = false) {
  const { x, y, w, h, angle } = part;
  const g = svg('g', { transform: `translate(${x} ${y}) rotate(${angle})` });
  const fill = blueprint ? colors.fixture : part.fill;
  const stroke = blueprint ? colors.ink : part.stroke;
  const attrs = { fill: part.solid ? fill : 'none', stroke, 'stroke-width': part.weight, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (part.type === 'symbol') g.append(drawSymbol(part.symbol, w, h, colors, fill));
  else if (part.type === 'rectangle') g.append(rect(-w / 2, -h / 2, w, h, 0, attrs));
  else if (part.type === 'ellipse') g.append(ellipse(0, 0, w / 2, h / 2, attrs));
  else if (part.type === 'line') g.append(path(`M${-w / 2} ${-h / 2}L${w / 2} ${h / 2}`, attrs));
  else if (part.type === 'polygon') g.append(svg('polygon', { points: part.points.map(([x, y]) => `${x * w},${y * h}`).join(' '), ...attrs }));
  else if (part.type === 'text') g.append(svg('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    'font-family': 'system-ui, sans-serif', 'font-size': Math.min(h * .75, w / Math.max(1, part.text.length * .62)), fill: stroke }, part.text));
  return g;
}
export function drawFurniture(item, colors, fill, blueprint = false) {
  if (item.variant !== 'custom') return drawSymbol(item.variant, item.w, item.h, colors, fill);
  const { w, h, parts } = item.design;
  return svg('g', { transform: `scale(${item.w / w} ${item.h / h})` }, ...parts.map(part => drawPart(part, colors, blueprint)));
}

export function furniturePreview(item) {
  const svgPreview = svg('svg', { viewBox: '-52 -35 104 70', 'aria-hidden': 'true' });
  const size = Math.min(92 / item.w, 58 / item.h);
  svgPreview.append(drawFurniture({ ...item, w: item.w * size, h: item.h * size }, furniturePreviewColors, '#c9aa82'));
  return svgPreview;
}
