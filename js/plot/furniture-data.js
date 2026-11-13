import { FURNITURE_CATEGORIES, furnitureDefinition } from './furniture-catalog.js';

export const FURNITURE_FORMAT = 'plotforge-furniture';
export const FURNITURE_VERSION = 1;
export const FURNITURE_PREFERENCE = 'furniture-library';
export const MAX_LIBRARY_BYTES = 4 * 1024 * 1024;
export const MAX_TEMPLATES = 500;
export const MAX_PARTS = 200;
export const PART_NAMES = { rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', polygon: 'Polygon', text: 'Text' };
export const DESIGN_BOX = { w: 600, h: 400 };
export const FURNITURE_COLOR = '#af8b62';
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const invalid = message => { throw new Error(message); };

function validatePart(part) {
  if (!record(part) || typeof part.type !== 'string' || (!Object.hasOwn(PART_NAMES, part.type) && part.type !== 'symbol') ||
      ![part.x, part.y].every(n => finite(n, -10_000, 10_000)) ||
      ![part.w, part.h].every(n => finite(n, .01, 10_000)) || !finite(part.angle, -360, 360) ||
      !color(part.fill) || !color(part.stroke) || !finite(part.weight, 0, 50) || typeof part.solid !== 'boolean') {
    invalid('Invalid custom furniture shape.');
  }
  if (part.type === 'text' && !text(part.text, 160)) invalid('Invalid furniture text.');
  if (part.type === 'symbol' && !furnitureDefinition(part.symbol)) invalid('Unknown built-in furniture symbol.');
  if (part.type === 'polygon' && (!Array.isArray(part.points) || part.points.length < 3 || part.points.length > 100 ||
      !part.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => finite(n, -.5, .5))))) invalid('Invalid furniture polygon.');
}

export function validateFurnitureDesign(design) {
  if (!record(design) || ![design.w, design.h].every(n => finite(n, 1, 2000)) ||
      !Array.isArray(design.parts) || !design.parts.length || design.parts.length > MAX_PARTS) invalid('Invalid custom furniture design.');
  design.parts.forEach(validatePart);
  return design;
}
export const furnitureLibraryFile = templates => ({ format: FURNITURE_FORMAT, version: FURNITURE_VERSION, templates });

export function readFurnitureLibrary(value) {
  if (!record(value) || value.format !== FURNITURE_FORMAT || value.version !== FURNITURE_VERSION ||
      !Array.isArray(value.templates) || value.templates.length > MAX_TEMPLATES) invalid('Unsupported furniture library file.');
  const ids = new Set();
  for (const item of value.templates) {
    if (!record(item) || !uuid(item.id) || ids.has(item.id) || !text(item.name, 160) || !item.name.trim() ||
        typeof item.category !== 'string' || !Object.hasOwn(FURNITURE_CATEGORIES, item.category) || ![item.w, item.h].every(n => finite(n, 1, 1_000_000))) {
      invalid('Invalid furniture template.');
    }
    ids.add(item.id);
    validateFurnitureDesign(item.design);
  }
  return value.templates;
}
export function makePart(type, x, y) {
  return { type, x, y, w: 135, h: type === 'text' ? 42 : 88, angle: 0, fill: FURNITURE_COLOR, stroke: '#473b2d',
    weight: 2, solid: type !== 'line', ...(type === 'text' && { text: 'Text' }) };
}
export function newTemplate(category = 'my') {
  return { id: crypto.randomUUID(), name: 'Custom furniture', category, w: 100, h: 60, design: { ...DESIGN_BOX, parts: [] } };
}

// Copy existing geometry into a common drawing space without depending on its project or template.
export function designFromObjects(items, bounds) {
  const scale = Math.min(540 / Math.max(1, bounds.w), 340 / Math.max(1, bounds.h));
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  const parts = items.flatMap(item => {
    const x = (item.x - center.x) * scale, y = (item.y - center.y) * scale;
    const w = Math.max(.01, item.w * scale), h = Math.max(.01, item.h * scale);
    if (item.variant === 'custom') {
      // Flatten uniformly scaled custom designs without distorting their child shapes.
      const ratio = w / item.design.w;
      if (Math.abs(ratio - h / item.design.h) > 1e-6 || item.angle) {
        invalid('To save a selection as furniture, use basic shapes, built-in furniture, or unrotated custom furniture with its original proportions.');
      }
      return item.design.parts.map(part => ({ ...part, x: x + part.x * ratio, y: y + part.y * ratio,
        w: part.w * ratio, h: part.h * ratio, weight: Math.min(50, part.weight * ratio) }));
    }
    const type = item.type === 'furniture' ? 'symbol' : item.type === 'label' ? 'text' : item.variant === 'circle' ? 'ellipse' :
      item.variant === 'triangle' ? 'polygon' : 'rectangle';
    return [{ ...makePart(type, x, y), w, h, angle: item.angle, fill: item.color,
      ...(type === 'symbol' && { symbol: item.variant }), ...(type === 'text' && { text: item.name }),
      ...(type === 'polygon' && { points: [[0, -.5], [.5, .5], [-.5, .5]] }) }];
  });
  return { w: Math.min(1_000_000, Math.max(1, bounds.w)), h: Math.min(1_000_000, Math.max(1, bounds.h)),
    design: { w: Math.max(1, bounds.w * scale), h: Math.max(1, bounds.h * scale), parts } };
}
