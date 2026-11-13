import { $, button, element } from './common.js';
import { amount, FLOOR_UNITS, PLAN_LIMIT } from './floor-model.js';
import { FURNITURE_CATEGORIES } from './furniture-catalog.js';
import { makePart, MAX_PARTS, PART_NAMES, validateFurnitureDesign } from './furniture-data.js';
import { drawPart, furniturePreviewColors, svg } from './furniture-render.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const radians = angle => angle * Math.PI / 180;
const rotate = (x, y, angle) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });

export function bindFurnitureDesigner() {
  const dialog = $('furniture-designer'), form = $('furniture-design-form'), scene = $('furniture-design-scene');
  const name = $('furniture-name'), category = $('furniture-category-select'), width = $('furniture-width'), depth = $('furniture-depth');
  const error = $('furniture-design-error'), tools = $('furniture-part-tools'), properties = $('furniture-part-properties');
  const grid = $('furniture-grid'), snap = $('furniture-snap'), hint = $('furniture-design-hint');
  let source, save, unit, design, selected, mode, vertices, drag, hover;
  for (const [key, [label]] of Object.entries(FURNITURE_CATEGORIES)) {
    const option = element('option', null, label);
    option.value = key;
    category.append(option);
  }
  const toolButtons = new Map(Object.entries({ select: 'Select', ...PART_NAMES }).map(([key, label]) => {
    const control = button(label, () => { mode = key; vertices = []; hover = undefined; paint(); });
    tools.append(control);
    return [key, control];
  }));
  const spacing = () => Math.max(1, Math.round(Math.max(design.w, design.h) / 30));
  function location(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(scene.getScreenCTM().inverse());
    const gap = spacing();
    const snapValue = value => snap.checked && !event.altKey ? Math.round(value / gap) * gap : value;
    return { x: clamp(snapValue(point.x), -design.w / 2, design.w / 2),
      y: clamp(snapValue(point.y), -design.h / 2, design.h / 2) };
  }
  function paint() {
    const w = design.w, h = design.h, gap = spacing();
    scene.setAttribute('viewBox', `${-w / 2} ${-h / 2} ${w} ${h}`);
    const defs = svg('defs', {}, svg('pattern', { id: 'furniture-design-grid', width: gap, height: gap, patternUnits: 'userSpaceOnUse' },
      svg('path', { d: `M${gap} 0H0V${gap}`, fill: 'none', stroke: '#c9bca8', 'vector-effect': 'non-scaling-stroke' })));
    scene.replaceChildren(defs, svg('rect', { x: -w / 2, y: -h / 2, width: w, height: h, fill: '#faf5ec' }));
    if (grid.checked) scene.append(svg('rect', { x: -w / 2, y: -h / 2, width: w, height: h, fill: 'url(#furniture-design-grid)' }));
    design.parts.forEach((part, index) => {
      const node = drawPart(part, furniturePreviewColors);
      node.setAttribute('data-part', index);
      if (part.type === 'text') node.prepend(svg('rect', { x: -part.w / 2, y: -part.h / 2, width: part.w, height: part.h, fill: 'transparent' }));
      scene.append(node);
    });
    const part = design.parts[selected];
    if (part && mode === 'select') {
      const control = svg('g', { transform: `translate(${part.x} ${part.y}) rotate(${part.angle})`, 'data-part': selected });
      const size = Math.max(w, h) / 100;
      const outline = { stroke: '#246686', 'vector-effect': 'non-scaling-stroke', fill: 'none', 'pointer-events': 'none' };
      control.append(svg('rect', { x: -part.w / 2, y: -part.h / 2, width: part.w, height: part.h, ...outline }),
        svg('line', { x1: 0, x2: 0, y1: -part.h / 2, y2: -part.h / 2 - size * 4, ...outline }),
        svg('circle', { cx: 0, cy: -part.h / 2 - size * 4, r: size, fill: '#246686', 'data-grip': 'rotate' }),
        svg('circle', { cx: part.w / 2, cy: part.h / 2, r: size, fill: '#246686', 'data-grip': 'resize' }));
      scene.append(control);
    }
    if (mode === 'polygon' && vertices.length) {
      scene.append(svg('polyline', { points: [...vertices, ...(hover ? [hover] : [])].map(p => `${p.x},${p.y}`).join(' '),
        fill: 'none', stroke: '#246686', 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
    }
    hint.textContent = mode === 'polygon' ? 'Click vertices, then press Enter to close the polygon.' :
      mode === 'select' ? 'Drag a shape or use its handles and properties.' : 'Click the drawing to add the shape.';
    for (const [key, control] of toolButtons) control.setAttribute('aria-pressed', String(key === mode));
  }
  function refresh() {
    paint();
    properties.replaceChildren();
    const part = design.parts[selected];
    if (!part) { properties.append(element('p', null, 'Select a shape to edit its properties.')); return; }
    const field = (label, type, value, min, max) => {
      const input = element('input'), row = element('label', 'plot-field');
      Object.assign(input, { type });
      if (type === 'checkbox') input.checked = part[value];
      else input.value = part[value];
      if (type === 'text') input.maxLength = 160;
      if (type === 'number') Object.assign(input, { step: 'any', min, max });
      input.onchange = () => {
        if (type === 'number' && (!input.checkValidity() || !Number.isFinite(input.valueAsNumber))) { input.value = part[value]; return; }
        part[value] = type === 'checkbox' ? input.checked : type === 'number' ? input.valueAsNumber : input.value;
        paint();
      };
      row.append(element('span', null, label), input);
      properties.append(row);
    };
    properties.append(element('h2', null, PART_NAMES[part.type] ?? 'Furniture symbol'));
    if (part.type === 'text') field('Shape text', 'text', 'text');
    field('Shape width', 'number', 'w', .01, 10000);
    field('Shape depth', 'number', 'h', .01, 10000);
    field('Shape rotation', 'number', 'angle', -360, 360);
    field('Fill color', 'color', 'fill');
    field('Border color', 'color', 'stroke');
    field('Border width', 'number', 'weight', 0, 50);
    if (part.type !== 'line' && part.type !== 'text') field('Fill shape', 'checkbox', 'solid');
    const reorder = direction => {
      const index = selected + direction;
      if (index < 0 || index >= design.parts.length) return;
      [design.parts[index], design.parts[selected]] = [design.parts[selected], design.parts[index]];
      selected = index;
      refresh();
    };
    properties.append(button('Bring Forward', () => reorder(1)), button('Send Backward', () => reorder(-1)),
      button('Delete Shape', () => { design.parts.splice(selected, 1); selected = undefined; refresh(); }));
  }
  function add(part) {
    if (design.parts.length >= MAX_PARTS) { error.textContent = `A design can contain up to ${MAX_PARTS} shapes.`; return; }
    selected = design.parts.push(part) - 1;
    mode = 'select';
    vertices = [];
    refresh();
  }
  function closePolygon() {
    const xs = vertices.map(p => p.x), ys = vertices.map(p => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (vertices.length < 3 || !w || !h) { error.textContent = 'Choose at least three corners for the polygon.'; return; }
    const x = Math.min(...xs) + w / 2, y = Math.min(...ys) + h / 2;
    add({ ...makePart('polygon', x, y), w, h, points: vertices.map(p => [(p.x - x) / w, (p.y - y) / h]) });
  }
  scene.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    error.textContent = '';
    const p = location(event);
    scene.focus({ preventScroll: true });
    if (mode === 'polygon') {
      if (vertices.length >= 3 && Math.hypot(p.x - vertices[0].x, p.y - vertices[0].y) < spacing()) closePolygon();
      else if (vertices.length < 100) { vertices.push(p); paint(); }
      return;
    }
    if (mode !== 'select') {
      const part = makePart(mode, p.x, p.y);
      part.w *= design.w / 600;
      part.h *= design.h / 400;
      part.weight *= Math.max(design.w, design.h) / 600;
      add(part);
      return;
    }
    const hit = event.target.closest('[data-part]');
    selected = hit ? Number(hit.dataset.part) : undefined;
    if (hit) {
      drag = { id: event.pointerId, start: p, part: { ...design.parts[selected] }, grip: event.target.dataset.grip };
      scene.setPointerCapture(event.pointerId);
    }
    refresh();
  });
  scene.addEventListener('pointermove', event => {
    if (mode === 'polygon') { hover = location(event); paint(); return; }
    if (drag?.id !== event.pointerId) return;
    const p = location(event), { part, start, grip } = drag;
    const current = design.parts[selected];
    if (grip === 'rotate') current.angle = Math.round(Math.atan2(p.y - part.y, p.x - part.x) * 180 / Math.PI + 90);
    else if (grip === 'resize') {
      const local = rotate(p.x - part.x, p.y - part.y, -radians(part.angle));
      current.w = Math.max(.01, Math.abs(local.x) * 2);
      current.h = Math.max(.01, Math.abs(local.y) * 2);
    } else {
      current.x = clamp(part.x + p.x - start.x, -design.w / 2, design.w / 2);
      current.y = clamp(part.y + p.y - start.y, -design.h / 2, design.h / 2);
    }
    paint();
  });
  const finishDrag = event => {
    if (drag?.id !== event.pointerId) return;
    drag = undefined;
    refresh();
  };
  scene.addEventListener('pointerup', finishDrag);
  scene.addEventListener('pointercancel', finishDrag);
  scene.addEventListener('lostpointercapture', finishDrag);
  grid.onchange = paint;
  dialog.addEventListener('keydown', event => {
    if (mode === 'polygon' && event.key === 'Enter' && !event.target.matches('input,select')) {
      event.preventDefault();
      closePolygon();
    }
    if (event.key === 'Escape' && mode !== 'select') { event.preventDefault(); mode = 'select'; vertices = []; refresh(); }
  });
  $('furniture-design-cancel').onclick = () => dialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    if ($('furniture-design-save').disabled) return;
    const factor = FLOOR_UNITS[unit], label = name.value.trim();
    error.textContent = '';
    $('furniture-design-save').disabled = true;
    try {
      if (!label) throw new Error('Enter a furniture name.');
      const w = clamp(width.valueAsNumber * factor, 1, PLAN_LIMIT), h = clamp(depth.valueAsNumber * factor, 1, PLAN_LIMIT);
      if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error('Enter valid default dimensions.');
      await save({ ...source, name: label, category: category.value, w, h, design: validateFurnitureDesign(design) });
      dialog.close();
    } catch (failure) { error.textContent = failure.message; }
    finally { $('furniture-design-save').disabled = false; }
  };
  return (template, options) => {
    source = template;
    ({ save, unit } = options);
    design = structuredClone(template.design);
    name.value = template.name;
    category.value = template.category;
    $('furniture-template-category').hidden = Boolean(options.instance);
    $('furniture-designer-title').textContent = options.title;
    $('furniture-design-save').textContent = options.instance ? 'Save Instance' : 'Save Furniture';
    for (const [field, label, value] of [[width, 'Default width', template.w], [depth, 'Default depth', template.h]]) {
      Object.assign(field, { min: amount(1, unit), max: amount(PLAN_LIMIT, unit), value: amount(value, unit) });
      field.setAttribute('aria-label', `${label} (${unit})`);
    }
    selected = drag = hover = undefined;
    mode = 'select';
    vertices = [];
    error.textContent = '';
    refresh();
    dialog.showModal();
    name.focus();
    name.select();
  };
}
