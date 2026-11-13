import { $, ask, button, element, report, task } from './common.js';
import { bindFurnitureLibrary } from './furniture-library.js';
import { designFromObjects, MAX_PARTS } from './furniture-data.js';
import { fitView, worldAt } from './geometry.js';
import {
  activeFloor, amount, attached, changePoints, deleteFloorItems, distance, drawRoom, drawWall, envelope,
  FLOOR_ITEMS, FLOOR_NAMES, FLOOR_UNITS, itemBox, makeFloor, makeFloorItem, makeOpening, measure, nearestWall,
  openingPosition, PLAN_LIMIT, replaceItem, resizeRoom, snapPoint, translateFloorItems, updateFloor, verticesOf, xy,
} from './floor-model.js';
import { drawFloor, floorBounds } from './floor-render.js';
import { drawFurniture, svg } from './furniture-render.js';

const TOOLS = {
  select: ['Select', 'V', 'Drag objects to move them. Shift-click or drag a box to select several.'],
  wall: ['Wall', 'W', 'Click endpoints to draw connected walls. Press Esc or right-click to finish.'],
  room: ['Rectangle room', 'R', 'Drag a rectangle or click two opposite corners.'],
  polygon: ['Custom room', 'P', 'Click room corners. Click the first corner or press Enter to close.'],
  door: ['Door', 'D', 'Click a wall to place a door.'],
  window: ['Window', 'N', 'Click a wall to place a window.'],
  stairs: ['Stairs', 'S', 'Click to place stairs.'],
  furniture: ['Furniture', 'F', 'Drag an item from the library or choose one and click to place it.'],
  label: ['Text', 'T', 'Click to place a text label.'],
  shape: ['Shape', 'G', 'Click to place a shape.'],
};
const units = { ft: 'Feet', in: 'Inches', m: 'Meters', cm: 'Centimeters' };
const styles = { blueprint: 'Blueprint', furnished: 'Furnished' };
const surfaces = { plain: 'Solid', wood: 'Wood', tile: 'Tile' };
const swings = { 'left-in': 'Left, inward', 'right-in': 'Right, inward', 'left-out': 'Left, outward', 'right-out': 'Right, outward' };
const corners = (a, b) => [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
const viewBox = (view, canvas) => ({ x: -view.x / view.zoom, y: -view.y / view.zoom,
  w: canvas.clientWidth / view.zoom, h: canvas.clientHeight / view.zoom });
const boundsIntersect = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

function field(label, control) {
  const row = element('label', 'plot-field');
  row.append(element('span', null, label), control);
  return row;
}
function select(label, choices, current, change) {
  const control = element('select');
  for (const [value, name] of Object.entries(choices)) {
    const option = element('option', null, name);
    option.value = value;
    control.append(option);
  }
  control.value = current;
  control.onchange = () => change(control.value);
  return field(label, control);
}
function input(label, type, value, change, attrs = {}) {
  const control = element('input');
  Object.assign(control, { type, ...attrs });
  if (type === 'checkbox') control.checked = value;
  else control.value = value;
  control.onchange = () => {
    if (type === 'number' && (!control.checkValidity() || !Number.isFinite(control.valueAsNumber))) {
      control.value = value;
      return;
    }
    change(type === 'checkbox' ? control.checked : type === 'number' ? control.valueAsNumber : control.value);
  };
  return field(label, control);
}

export function bindFloorEditor(editor) {
  const canvas = $('plot-canvas'), scene = $('floor-scene'), toolbar = $('floor-tools');
  const actions = $('floor-drawing-tools'), variant = $('floor-variant');
  const floorPicker = $('floor-picker'), stylePicker = $('floor-style'), inspector = $('inspector-body');
  const variants = Object.fromEntries(Object.entries(FLOOR_ITEMS).map(([type, items]) => [type, Object.keys(items)[0]]));
  let plan, boardId, tool = 'select', anchor, polygon = [], hover, pointer, draft, marquee, frame = 0;
  let selected = new Set(), thickness = 15, furnitureChoice;
  const active = () => activeFloor(plan);
  const commitFloor = floor => editor.change(updateFloor(plan, floor));
  const setting = changes => editor.change({ ...plan, ...changes });
  const toolButtons = new Map(Object.entries(TOOLS).map(([id, [label, shortcut]]) => {
    const control = button(label, () => choose(id));
    control.dataset.floorTool = id;
    control.title = `${label} (${shortcut})`;
    actions.append(control);
    return [id, control];
  }));
  const library = bindFurnitureLibrary({
    canvas, unit: () => plan.unit,
    pick(item) {
      furnitureChoice = item;
      library.select(item);
      choose('furniture');
    },
    drop(item, event) {
      if (!plan) return;
      furnitureChoice = item;
      place('furniture', item, location(event, false));
    },
    close: () => choose('select'),
  });
  function updateTools() {
    for (const [id, control] of toolButtons) control.setAttribute('aria-pressed', String(tool === id));
    const choices = FLOOR_ITEMS[tool];
    variant.hidden = !choices || ['label', 'window', 'furniture'].includes(tool);
    if (!variant.hidden) {
      variant.replaceChildren(select('Type', choices, variants[tool], value => { variants[tool] = value; }).lastElementChild);
      variant.firstElementChild.setAttribute('aria-label', 'Drawing type');
    }
    if (tool === 'furniture') { library.open(); library.select(furnitureChoice); }
    else library.hide();
    canvas.closest('.plot-workspace').classList.toggle('browsing-furniture', tool === 'furniture');
    scene.dataset.tool = tool;
    status();
  }
  function choose(next) {
    reset();
    tool = next;
    if (next !== 'select') selected = new Set();
    updateTools();
    properties();
    schedulePaint();
    canvas.focus({ preventScroll: true });
  }
  function reset() {
    const old = pointer;
    pointer = anchor = hover = draft = marquee = undefined;
    polygon = [];
    if (old && canvas.hasPointerCapture(old.id)) canvas.releasePointerCapture(old.id);
  }
  function status() {
    if (!plan) return;
    if (tool === 'furniture' && furnitureChoice) {
      $('selection-status').textContent = `Click to place ${furnitureChoice.name}. Press Esc to finish.`;
    } else $('selection-status').textContent = selected.size && tool === 'select' ? `${selected.size} selected` : TOOLS[tool][2];
    $('board-status').textContent = `${active().name} · ${active().objects.length} objects`;
  }
  function schedulePaint(immediate = false) {
    if (!plan) return;
    if (immediate && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (immediate) paint();
    else if (!frame) frame = requestAnimationFrame(paint);
  }
  function paint() {
    frame = 0;
    if (!plan) return;
    const view = editor.view(), box = viewBox(view, canvas);
    if (!box.w || !box.h) return;
    scene.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    let preview;
    const first = pointer?.kind === 'draw' && tool === 'room' ? pointer.start : anchor;
    if (hover && first && tool === 'room') {
      preview = corners(first, hover);
      preview.closed = true;
    } else if (hover && tool === 'wall') preview = anchor ? [anchor, hover] : [hover];
    else if (hover && tool === 'polygon') preview = [...polygon, hover];
    else if (hover && ['door', 'window'].includes(tool)) {
      const hit = nearestWall(active(), hover, 18 / view.zoom);
      if (hit) {
        const p = openingPosition(makeOpening(tool, variants[tool], hit), active()), angle = p.angle * Math.PI / 180;
        const dx = Math.cos(angle) * p.width / 2, dy = Math.sin(angle) * p.width / 2;
        preview = [{ x: p.x - dx, y: p.y - dy }, { x: p.x + dx, y: p.y + dy }];
      }
    } else if (hover && tool !== 'select') preview = [hover];
    scene.replaceChildren(drawFloor(plan, draft ?? active(), box, {
      selected, variables: editor.variables(), zoom: view.zoom, preview, marquee, interactive: true,
    }));
    if (tool === 'furniture' && furnitureChoice && hover) {
      const ghost = { ...furnitureChoice, variant: furnitureChoice.design ? 'custom' : furnitureChoice.id };
      const colors = plan.style === 'blueprint' ? { ink: '#dbeefa', fixture: '#203f57' } : { ink: '#453b31', fixture: '#efe0c9' };
      const drawing = drawFurniture(ghost, colors, colors.fixture, plan.style === 'blueprint');
      scene.append(svg('g', { transform: `translate(${hover.x} ${hover.y})`, opacity: .58, 'pointer-events': 'none' }, drawing));
    }
  }

  function properties() {
    if (!plan) return;
    const floor = active(), item = selected.size === 1 && floor.objects.find(item => selected.has(item.id));
    const parts = [];
    const group = (name, ...controls) => parts.push(element('h2', null, name), ...controls);
    const patch = changes => commitFloor(replaceItem(floor, { ...item, ...changes }));
    const numeric = (label, value, onChange, min = 1, max = PLAN_LIMIT) => input(
      `${label} (${plan.unit})`, 'number', amount(value, plan.unit), n => onChange(Math.max(min, Math.min(max, n * FLOOR_UNITS[plan.unit]))),
      { min: amount(min, plan.unit), max: amount(max, plan.unit), step: 'any', required: true },
    );
    const name = item && input(item.type === 'label' ? 'Text' : 'Name', 'text', item.name, value => patch({ name: value.trim() || FLOOR_NAMES[item.type] }), { maxLength: 160 });
    const color = label => input(label, 'color', item.color, value => patch({ color: value }));
    function changeGeometry(next) {
      if (next === floor) {
        report(new Error('That edit would overlap room edges or collapse a wall.'));
        properties();
      } else commitFloor(next);
    }
    if (!item && selected.size) group(`${selected.size} objects`);
    else if (!item) {
      group('Floor plan', element('p', null, TOOLS[tool][2]));
      if (tool === 'wall' || tool === 'room' || tool === 'polygon') parts.push(numeric('New wall thickness', thickness, value => { thickness = value; }, 1, 500));
      parts.push(
        select('Units', units, plan.unit, unit => setting({ unit })),
        input('Show grid', 'checkbox', plan.grid, grid => setting({ grid })),
        input('Snap to grid', 'checkbox', plan.snap, snap => setting({ snap })),
        input('Snap to walls', 'checkbox', plan.wallSnap, wallSnap => setting({ wallSnap })),
        numeric('Grid spacing', plan.spacing, spacing => setting({ spacing }), 1, 5000),
      );
    } else if (item.type === 'wall') {
      const a = floor.points[item.a], b = floor.points[item.b], length = distance(a, b);
      group('Wall', numeric('Length', length, value => {
        const factor = value / length;
        changeGeometry(changePoints(floor, { [item.b]: xy(a.x + (b.x - a.x) * factor, a.y + (b.y - a.y) * factor) }));
      }), numeric('Thickness', item.thickness, value => patch({ thickness: value }), 1, 500));
    } else if (item.type === 'room') {
      const { w, h } = itemBox(item, floor);
      group('Room', name,
        numeric('Width', w, value => changeGeometry(resizeRoom(floor, item, value, h))),
        numeric('Depth', h, value => changeGeometry(resizeRoom(floor, item, w, value))),
        color('Surface color'), select('Surface', surfaces, item.surface, surface => patch({ surface })));
    } else if (attached(item)) {
      const { at, length, width } = openingPosition(item, floor);
      group(FLOOR_NAMES[item.type],
        numeric('Width', width, value => patch({ width: Math.min(length, value) }), 1, Math.min(length, 5000)),
        numeric('Position on wall', at * length, value => patch({ at: Math.min(1, value / length) }), 0, length));
      if (item.type === 'door') parts.push(select('Door type', FLOOR_ITEMS.door, item.variant, variant => patch({ variant })),
        select('Swing', item.variant === 'double' ? { 'left-in': 'Inward', 'left-out': 'Outward' } : swings,
          item.variant === 'double' ? `left-${item.swing.split('-')[1]}` : item.swing, swing => patch({ swing })));
    } else {
      group(FLOOR_NAMES[item.type], name,
        numeric('Width', item.w, w => patch({ w })),
        numeric('Depth', item.h, h => patch({ h })),
        numeric('X', item.x, x => patch(xy(x, item.y)), -PLAN_LIMIT),
        numeric('Y', item.y, y => patch(xy(item.x, y)), -PLAN_LIMIT),
        input('Rotation (°)', 'number', item.angle, angle => patch({ angle }), { min: -360, max: 360, step: 'any' }), color('Color'));
      if (Object.keys(FLOOR_ITEMS[item.type] ?? {}).length > 1) parts.push(select('Type', FLOOR_ITEMS[item.type], item.variant, variant => patch({ variant })));
    }
    if (item?.variant === 'custom') parts.push(button('Edit Instance Design', () => library.editInstance(item, edited => {
      patch({ name: edited.name, w: edited.w, h: edited.h, design: structuredClone(edited.design) });
    }), 'secondary-button'));
    const reusable = floor.objects.filter(model => selected.has(model.id) && ['shape', 'furniture', 'label'].includes(model.type));
    if (reusable.length === selected.size && reusable.length) {
      parts.push(button('Duplicate Selection', duplicate, 'secondary-button'));
      parts.push(button('Save Selection as Furniture', task(() => {
        const { x, y, w, h } = floorBounds({ ...floor, objects: reusable });
        const result = designFromObjects(reusable, { x, y, w, h });
        if (!result.design.parts.length || result.design.parts.length > MAX_PARTS) {
          report(new Error(`Select up to ${MAX_PARTS} reusable shapes.`));
          return;
        }
        library.createFrom(result);
      }), 'secondary-button'));
    }
    if (selected.size) parts.push(button('Delete selection', remove, 'secondary-button'));
    inspector.replaceChildren(...parts);
  }

  function selectItems(ids) {
    selected = ids;
    status();
    properties();
    schedulePaint();
  }
  function selectAll() {
    choose('select');
    selectItems(new Set(active().objects.map(item => item.id)));
  }
  function duplicate() {
    const floor = active(), gap = plan.snap ? plan.spacing : 20;
    const copies = floor.objects.filter(model => selected.has(model.id) && ['shape', 'furniture', 'label'].includes(model.type))
      .map(model => ({ ...structuredClone(model), id: crypto.randomUUID(), ...xy(model.x + gap, model.y + gap) }));
    if (!copies.length) return;
    selected = new Set(copies.map(model => model.id));
    commitFloor({ ...floor, objects: [...floor.objects, ...copies] });
  }
  function remove() {
    if (!selected.size) return;
    const next = deleteFloorItems(active(), selected);
    selected = new Set();
    commitFloor(next);
  }
  function finishRoom(points) {
    const result = drawRoom(active(), points, thickness);
    if (!result) { report(new Error('Draw a closed room with at least three corners and no crossing edges.')); return; }
    choose('select');
    selected = new Set([result.item.id]);
    commitFloor(result.floor);
  }
  function place(type, id, p) {
    const floor = active();
    let item;
    if (type === 'door' || type === 'window') {
      const hit = nearestWall(floor, p, 18 / editor.view().zoom);
      if (!hit) { report(new Error('Choose a wall to place this opening.')); return; }
      item = makeOpening(type, id, hit);
    } else item = makeFloorItem(type, id, p);
    if (type !== 'furniture') choose('select');
    else {
      tool = 'furniture';
      updateTools();
      canvas.focus({ preventScroll: true });
    }
    selected = new Set([item.id]);
    commitFloor({ ...floor, objects: [...floor.objects, item] });
    if (type === 'label') {
      const text = inspector.querySelector('input[type=text]');
      text?.focus();
      text?.select();
    }
  }
  function rawLocation(event) {
    const rect = canvas.getBoundingClientRect();
    return worldAt(editor.view(), event.clientX - rect.left, event.clientY - rect.top);
  }
  function location(event, wallSnap = true, except = new Set()) {
    const p = rawLocation(event);
    return event.altKey ? xy(p.x, p.y) : snapPoint(plan, active(), p, 12 / editor.view().zoom, except, wallSnap);
  }
  function drawEnd(event, current) {
    const p = ['door', 'window'].includes(tool) ? rawLocation(event) : location(event, ['wall', 'room', 'polygon'].includes(tool));
    if (tool === 'wall') {
      if (!anchor) anchor = p;
      else {
        const result = drawWall(active(), anchor, p, thickness);
        if (result) { anchor = result.end; commitFloor(result.floor); }
      }
    } else if (tool === 'room') {
      const a = anchor ?? (current.moved ? current.start : undefined);
      if (a) {
        const points = corners(a, p).map(point => snapPoint({ ...plan, snap: false }, active(), point, .01));
        if (Math.abs(a.x - p.x) >= 1 && Math.abs(a.y - p.y) >= 1) finishRoom(points);
      } else anchor = p;
    } else if (tool === 'polygon') {
      if (polygon.length >= 3 && distance(p, polygon[0]) < 12 / editor.view().zoom) finishRoom(polygon);
      else if (!polygon.some(point => distance(point, p) < 1) && polygon.length < 200) polygon.push(p);
    } else if (tool === 'furniture') {
      if (furnitureChoice) place(tool, furnitureChoice, p);
    } else place(tool, variants[tool], p);
  }
  function dragFloor(event, current) {
    const floor = current.floor, p = rawLocation(event), item = current.item;
    if (current.kind === 'marquee') {
      marquee = envelope([p, current.start]);
      return;
    }
    if (current.handle === 'vertex') {
      const next = location(event, true, new Set(verticesOf(item)));
      draft = changePoints(floor, { [current.vertex]: xy(next.x, next.y) });
    } else if (current.handle === 'room-size') {
      const box = itemBox(item, floor), handleGap = 13 / editor.view().zoom;
      const next = location(event, false);
      draft = resizeRoom(floor, item, Math.max(1, next.x - box.x - handleGap), Math.max(1, next.y - box.y - handleGap));
    } else if (current.handle === 'opening-size') {
      const opening = openingPosition(item, floor), a = opening.angle * Math.PI / 180;
      const width = Math.min(opening.length, 5000, Math.max(1, 2 * Math.abs((p.x - opening.x) * Math.cos(a) + (p.y - opening.y) * Math.sin(a))));
      draft = replaceItem(floor, { ...item, width });
    } else if (current.handle === 'rotate') {
      let angle = Math.atan2(p.y - item.y, p.x - item.x) * 180 / Math.PI + 90;
      if (event.shiftKey) angle = Math.round(angle / 15) * 15;
      draft = replaceItem(floor, { ...item, angle: Math.round(angle * 10) / 10 });
    } else if (current.handle === 'size') {
      const radians = -item.angle * Math.PI / 180, dx = p.x - item.x, dy = p.y - item.y;
      const snap = value => plan.snap && !event.altKey ? Math.round(value / plan.spacing) * plan.spacing : value;
      const dim = value => Math.max(1, Math.min(PLAN_LIMIT, snap(Math.abs(value) * 2)));
      draft = replaceItem(floor, { ...item, w: dim(dx * Math.cos(radians) - dy * Math.sin(radians)),
        h: dim(dx * Math.sin(radians) + dy * Math.cos(radians)) });
    } else if (attached(item) && selected.size === 1) {
      const hit = nearestWall(floor, p, 22 / editor.view().zoom);
      if (hit) draft = replaceItem(floor, { ...item, wall: hit.wall, at: hit.at });
    } else {
      const ref = item.type === 'wall' || item.type === 'room' ? floor.points[verticesOf(item)[0]] :
        attached(item) ? openingPosition(item, floor) : item;
      const target = { x: ref.x + p.x - current.start.x, y: ref.y + p.y - current.start.y };
      const moving = new Set(floor.objects.filter(other => selected.has(other.id)).flatMap(verticesOf));
      const snap = event.altKey ? target : snapPoint(plan, floor, target, 12 / editor.view().zoom, moving);
      draft = translateFloorItems(floor, selected, snap.x - ref.x, snap.y - ref.y);
    }
  }

  canvas.addEventListener('pointerdown', event => {
    if (!plan || event.button !== 0 || canvas.classList.contains('space-held') || event.target.closest('#zoom-controls') || !event.isPrimary) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.focus({ preventScroll: true });
    const floor = active(), hit = event.target.closest('[data-plan-id]');
    const item = hit && floor.objects.find(item => item.id === hit.dataset.planId);
    const handle = hit?.dataset.planHandle;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    if (tool === 'select' && item && !handle) {
      const ids = new Set(additive || selected.has(item.id) ? selected : []);
      if (additive && ids.has(item.id)) ids.delete(item.id);
      else ids.add(item.id);
      selectItems(ids);
      if (!ids.has(item.id)) return;
    }
    const kind = tool !== 'select' ? 'draw' : item ? 'move' : 'marquee';
    pointer = { id: event.pointerId, floor, kind, item, handle, vertex: hit?.dataset.vertex, additive,
      origin: rawLocation(event), start: kind === 'draw' ? location(event) : rawLocation(event) };
    canvas.setPointerCapture(event.pointerId);
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (!plan || canvas.classList.contains('panning') || canvas.classList.contains('space-held')) return;
    if (!pointer && tool === 'select') return;
    if (pointer?.id === event.pointerId) {
      pointer.moved ||= distance(rawLocation(event), pointer.origin) * editor.view().zoom > 5;
      if (pointer.moved && pointer.kind !== 'draw') dragFloor(event, pointer);
    }
    if (tool !== 'select') hover = ['door', 'window'].includes(tool) ? rawLocation(event) : location(event, ['wall', 'room', 'polygon'].includes(tool));
    schedulePaint();
  });
  function release(event, cancelled = false) {
    if (!plan || pointer?.id !== event.pointerId) return;
    const current = pointer, moved = draft, box = marquee;
    pointer = draft = marquee = undefined;
    if (canvas.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id);
    if (!cancelled) {
      if (current.kind === 'draw') drawEnd(event, current);
      else if (moved && moved !== current.floor) commitFloor(moved);
      else if (current.kind === 'marquee') {
        const walls = new Map(current.floor.objects.filter(item => item.type === 'wall').map(item => [item.id, item]));
        const hits = box ? current.floor.objects.filter(item => boundsIntersect(itemBox(item, current.floor, walls), box)).map(item => item.id) : [];
        selectItems(new Set([...(current.additive ? selected : []), ...hits]));
      }
    }
    schedulePaint();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', event => release(event, true));
  canvas.addEventListener('lostpointercapture', event => release(event, true));
  canvas.addEventListener('pointerleave', () => { if (!pointer) { hover = undefined; schedulePaint(); } });
  canvas.addEventListener('contextmenu', event => {
    if (!plan) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    choose('select');
  }, true);
  window.addEventListener('blur', () => { if (plan && pointer) { reset(); schedulePaint(); } });

  const keyTools = new Map(Object.entries(TOOLS).map(([id, [, key]]) => [key.toLowerCase(), id]));
  document.addEventListener('keydown', event => {
    if (!plan || event.defaultPrevented || document.querySelector('dialog[open]') ||
      event.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
    const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
    let action;
    if (command && key === 'a') action = selectAll;
    else if (command && key === 'd') action = duplicate;
    else if (command && ['z', 'y'].includes(key)) { reset(); schedulePaint(); return; }
    else if (key === 'delete' || key === 'backspace') action = remove;
    else if (key === 'escape') action = () => { selected = new Set(); choose('select'); };
    else if (key === 'enter' && tool === 'polygon' && polygon.length >= 3 && event.target === canvas) action = () => finishRoom(polygon);
    else if (!command && !event.altKey && keyTools.has(key)) action = () => choose(keyTools.get(key));
    if (action) { event.preventDefault(); action(); }
  }, true);

  floorPicker.onchange = () => editor.change({ ...plan, active: floorPicker.value }, false);
  stylePicker.onchange = () => setting({ style: stylePicker.value });
  $('floor-add').onclick = task(async () => {
    if (plan.floors.length >= 100) throw new Error('A floor plan can hold up to 100 floors.');
    const name = await ask('Add floor', 'Name the new floor.', `Floor ${plan.floors.length + 1}`, 'Add Floor');
    if (!name) return;
    const floor = makeFloor(name);
    setting({ floors: [...plan.floors, floor], active: floor.id });
  });
  $('floor-rename').onclick = task(async () => {
    const floor = active(), name = await ask('Rename floor', 'Choose a name for this floor.', floor.name);
    if (name) commitFloor({ ...floor, name });
  });
  $('floor-delete').onclick = task(async () => {
    if (plan.floors.length <= 1) return;
    const floor = active();
    if (!await ask('Delete floor?', `Delete ${floor.name} and its objects? You can undo this.`, undefined, 'Delete Floor')) return;
    const floors = plan.floors.filter(item => item.id !== floor.id);
    setting({ floors, active: floors[Math.max(0, plan.floors.indexOf(floor) - 1)].id });
  });

  return {
    sync(board, refresh) {
      const next = board.plan, changed = board.id !== boardId || next?.active !== plan?.active;
      if (changed) {
        reset();
        selected = new Set();
        tool = 'select';
      }
      boardId = board.id;
      const previous = plan;
      plan = next;
      scene.toggleAttribute('hidden', !plan);
      toolbar.hidden = !plan;
      canvas.classList.toggle('floor-plan-active', Boolean(plan));
      $('layers').hidden = Boolean(plan);
      $('guides-toggle').hidden = Boolean(plan);
      if (!plan) {
        library.hide();
        canvas.closest('.plot-workspace').classList.remove('browsing-furniture');
        return;
      }
      if (previous !== plan) {
        floorPicker.replaceChildren(...plan.floors.map(floor => {
          const option = element('option', null, floor.name);
          option.value = floor.id;
          return option;
        }));
        floorPicker.value = plan.active;
        stylePicker.value = plan.style;
        $('floor-delete').disabled = plan.floors.length <= 1;
      }
      const ids = new Set(active().objects.map(item => item.id));
      selected = new Set([...selected].filter(id => ids.has(id)));
      if (changed || !previous) updateTools();
      if (refresh) properties();
      status();
    },
    paint: schedulePaint,
    fit() {
      const { x, y, w, h } = floorBounds(active());
      editor.setView(fitView([{ x, y, w, h }], canvas.clientWidth, canvas.clientHeight));
    },
    selectAll,
    toggleGrid: () => setting({ grid: !plan.grid }),
  };
}
