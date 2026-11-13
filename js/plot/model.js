import { furnitureDefinition } from './furniture-catalog.js';
import { validateFurnitureDesign } from './furniture-data.js';
import { stackFamily, stackTree, stackWalk } from './stack-tree.js';
import { DATE_ORDERS, DATE_SEPARATORS, MONTH_FORMATS } from './timeline.js';
import { FLOOR_ITEMS, FLOOR_UNITS, PLAN_LIMIT } from './floor-model.js';

export const SCHEMA = 1;
export const ACCENT = '#B58A35';
export const WORLD = 10_000_000;
export const MEDIA_TYPES = ['image', 'audio', 'video'];
export const WORKSPACES = ['canvas', 'map', 'timeline'];
export const STACK_LAYOUTS = ['collapsed', 'vertical', 'horizontal', 'grid'];
export const DEFAULT_LAYER = { id: 'default', title: 'Default', hidden: false, locked: false };
export const TYPES = ['text', 'note', 'list', ...MEDIA_TYPES, 'shape', ...WORKSPACES, 'stack', 'reference', 'marker', 'event'];
export const SHAPES = ['rectangle', 'rounded', 'ellipse', 'line', 'arrow'];
export const LISTS = ['bullets', 'numbers', 'checklist'];
export const FONTS = ['System', 'Georgia', 'Arial', 'Courier New'];
export const id = () => crypto.randomUUID();
export const isId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export const viewDefault = () => ({ x: 0, y: 0, zoom: 1 });
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const point = value => clamp(value, -WORLD, WORLD);

export function createProject(title = 'Untitled Project') {
  const root = id();
  return {
    schema: SCHEMA, id: id(), title, createdAt: Date.now(), root,
    boards: { [root]: { id: root, elements: [], connections: [] } },
    view: { active: root, byBoard: {} }, settings: { grid: true, guides: true },
  };
}

export const boardLayers = board => board.layers ?? [DEFAULT_LAYER];
export const layerId = model => model.layerId ?? DEFAULT_LAYER.id;

export const SIZE = {
  text: [260, 150], note: [250, 200], list: [260, 200], image: [300, 200],
  audio: [315, 110], video: [320, 205], shape: [160, 115], canvas: [220, 100], stack: [400, 130], map: [220, 100], timeline: [220, 100],
  reference: [250, 175], marker: [155, 58], event: [218, 166],
};
export const LABEL = {
  text: 'Text', note: 'Note', list: 'List', image: 'Image', audio: 'Audio', video: 'Video',
  shape: 'Shape', canvas: 'Nested Canvas', stack: 'Stack', map: 'Map', timeline: 'Timeline',
  reference: 'Reference', marker: 'Location', event: 'Event',
};
export const ICON = { text: 'T', note: '▤', list: '☷', image: '▧', audio: '♫', video: '▷', shape: '◇', canvas: '▦', stack: '▱', map: '⌖', timeline: '↦', reference: '↗', marker: '●', event: '◆' };

export function makeElement(type, x, y, options = {}) {
  const [w, h] = SIZE[type];
  const element = { id: id(), type, x: point(x), y: point(y), w, h };
  if (type === 'text' || type === 'note') {
    Object.assign(element, { html: '', font: 'System', size: 16, align: 'left' });
    if (type === 'note') Object.assign(element, { title: 'Untitled Note', border: true });
  }
  if (type === 'list') Object.assign(element, { title: 'Untitled List', kind: 'checklist', items: [] });
  if (type === 'shape') Object.assign(element, { shape: 'rectangle', fill: ACCENT, stroke: '#83601e', weight: 2, opacity: 1, angle: 0 });
  if (WORKSPACES.includes(type)) Object.assign(element, { title: `Untitled ${type === 'canvas' ? 'Canvas' : LABEL[type]}`, boardId: id() });
  if (type === 'stack') Object.assign(element, { title: 'Untitled Stack', layout: 'collapsed', expanded: false });
  if (type === 'marker') Object.assign(element, { title: 'Location', color: ACCENT });
  if (type === 'event') Object.assign(element, { title: 'Untitled Event', description: '', date: '', time: '', duration: 0, chronology: null, color: ACCENT });
  return { ...element, ...options };
}

export function updateBoard(project, board) {
  return { ...project, boards: { ...project.boards, [board.id]: board } };
}

export function insertElement(project, boardId, element, plan) {
  const board = project.boards[boardId];
  const next = updateBoard(project, { ...board, elements: [...board.elements, element] });
  if (WORKSPACES.includes(element.type)) {
    const child = { id: element.boardId, elements: [], connections: [] };
    if (element.type !== 'canvas') child.kind = element.type;
    if (element.type === 'map' && plan) child.plan = plan;
    next.boards[element.boardId] = child;
  }
  return next;
}

export function* descendants(boards, roots) {
  const pending = [...roots].reverse();
  while (pending.length) {
    const key = pending.pop();
    const board = boards[key];
    yield board;
    for (let i = board.elements.length - 1; i >= 0; i--) {
      const element = board.elements[i];
      if (WORKSPACES.includes(element.type)) pending.push(element.boardId);
    }
  }
}

export function parents(project) {
  const map = new Map();
  for (const board of Object.values(project.boards)) {
    for (const element of board.elements) if (WORKSPACES.includes(element.type)) map.set(element.boardId, { board: board.id, element });
  }
  return map;
}

export function boardPath(project, boardId, map = parents(project)) {
  const path = [boardId];
  while (map.has(boardId)) {
    boardId = map.get(boardId).board;
    path.push(boardId);
  }
  return path.reverse();
}

export function removeSelection(project, boardId, ids, connectionId) {
  const board = project.boards[boardId];
  const removed = board.elements.filter(element => ids.has(element.id));
  const next = updateBoard(project, {
    ...board,
    background: ids.has(board.background) ? undefined : board.background,
    elements: board.elements.filter(element => !ids.has(element.id)).map(element =>
      ids.has(element.stackId) ? { ...element, stackId: undefined } : element),
    connections: board.connections.filter(connection => connection.id !== connectionId && !ids.has(connection.from) && !ids.has(connection.to)),
  });
  for (const child of descendants(project.boards, removed.filter(element => WORKSPACES.includes(element.type)).map(element => element.boardId))) {
    delete next.boards[child.id];
  }
  return next;
}

export function layer(board, ids, forward) {
  const elements = [...board.elements];
  const direction = forward ? -1 : 1;
  for (let i = forward ? elements.length - 2 : 1; i >= 0 && i < elements.length; i += direction) {
    const neighbor = i - direction;
    if (ids.has(elements[i].id) && !ids.has(elements[neighbor].id)) {
      [elements[i], elements[neighbor]] = [elements[neighbor], elements[i]];
    }
  }
  return elements.some((element, i) => element !== board.elements[i]) ? { ...board, elements } : board;
}

export function connect(board, from, to) {
  if (from === to || board.connections.some(connection => connection.from === from && connection.to === to)) return board;
  const connection = { id: id(), from, to, color: ACCENT, style: 'solid', arrow: true };
  return { ...board, connections: [...board.connections, connection] };
}

export function extractSelection(project, boardId, ids) {
  const board = project.boards[boardId];
  ids = stackFamily(board.elements, ids);
  const elements = board.elements.filter(element => ids.has(element.id)).map(element =>
    element.stackId && !ids.has(element.stackId) ? { ...element, stackId: undefined } : element);
  const connections = board.connections.filter(connection => ids.has(connection.from) && ids.has(connection.to));
  const children = [...descendants(project.boards, elements.filter(element => WORKSPACES.includes(element.type)).map(element => element.boardId))];
  const boards = Object.fromEntries(children.map(child => [child.id, child]));
  const views = Object.fromEntries(children.filter(child => project.view.byBoard[child.id]).map(child => [child.id, project.view.byBoard[child.id]]));
  return { elements, connections, boards, views, layers: board.layers, projectId: project.id };
}

export function insertSelection(project, boardId, fragment, dx, dy) {
  const board = project.boards[boardId];
  const available = boardLayers(board).filter(layer => !layer.hidden && !layer.locked);
  const defaultDestination = available.find(layer => layer.id === 'default')?.id ?? available[0]?.id ?? 'default';
  const boardIds = new Map(Object.keys(fragment.boards).map(key => [key, id()]));
  const elementIds = new Map([fragment, ...Object.values(fragment.boards)].flatMap(source =>
    source.elements.map(element => [element.id, id()])));
  const cloneContent = (source, offsetX, offsetY, root = false) => {
    const localIds = new Set(source.elements.map(element => element.id));
    const layerIds = new Map(boardLayers(source).filter(layer => layer.id !== 'default').map(layer => [layer.id, id()]));
    const elements = source.elements.map(element => {
      const copy = { ...element, id: elementIds.get(element.id), x: point(element.x + offsetX), y: point(element.y + offsetY) };
      if (WORKSPACES.includes(copy.type)) copy.boardId = boardIds.get(copy.boardId);
      if (copy.type === 'list') copy.items = copy.items.map(item => ({ ...item, id: id() }));
      if (copy.stackId) copy.stackId = localIds.has(copy.stackId) ? elementIds.get(copy.stackId) : undefined;
      if (root) {
        const destination = fragment.projectId === project.id && available.some(layer => layer.id === layerId(copy))
          ? layerId(copy) : defaultDestination;
        copy.layerId = destination === 'default' ? undefined : destination;
      } else if (copy.layerId && copy.layerId !== 'default') copy.layerId = layerIds.get(copy.layerId);
      if (copy.targetId) copy.targetId = elementIds.get(copy.targetId) ?? (fragment.projectId === project.id ? copy.targetId : id());
      return copy;
    });
    const connections = source.connections.map(link => ({ ...link, id: id(), from: elementIds.get(link.from), to: elementIds.get(link.to) }));
    const layers = source.layers?.map(layer => ({ ...layer, id: layerIds.get(layer.id) ?? 'default' }));
    return { elements, connections, layers, background: elementIds.get(source.background) };
  };
  const content = cloneContent(fragment, dx, dy, true);
  const next = updateBoard(project, {
    ...board, elements: [...board.elements, ...content.elements], connections: [...board.connections, ...content.connections],
  });
  const byBoard = { ...project.view.byBoard };
  for (const child of Object.values(fragment.boards)) {
    const key = boardIds.get(child.id);
    next.boards[key] = { id: key, kind: child.kind, ...cloneContent(child, 0, 0) };
    if (child.plan) next.boards[key].plan = structuredClone(child.plan);
    if (child.timeline) next.boards[key].timeline = { ...child.timeline };
    if (fragment.views[child.id]) byBoard[key] = fragment.views[child.id];
  }
  return { project: { ...next, view: { ...next.view, byBoard } }, ids: new Set(content.elements.map(element => element.id)) };
}

export function* projectElements(project) {
  for (const board of Object.values(project.boards)) yield* board.elements;
}

export const assetIds = project => new Set([...projectElements(project)].flatMap(element => element.asset ? [element.asset] : []));

export function statistics(project) {
  const result = { Canvases: Object.keys(project.boards).length, Elements: 0, Notes: 0, Images: 0, Audio: 0, Videos: 0, Lists: 0, Checked: 0, 'Checklist items': 0 };
  const key = { note: 'Notes', image: 'Images', audio: 'Audio', video: 'Videos', list: 'Lists' };
  for (const element of projectElements(project)) {
    result.Elements++;
    if (key[element.type]) result[key[element.type]]++;
    if (element.type === 'list' && element.kind === 'checklist') {
      result['Checklist items'] += element.items.length;
      result.Checked += element.items.filter(item => item.done).length;
    }
  }
  return result;
}

export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const fail = message => { throw new Error(message); };
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const string = (value, max) => typeof value === 'string' && value.length <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const flag = value => typeof value === 'boolean';
const optionalColor = value => value === undefined || validColor(value);

function validateFloorPlan(plan) {
  if (!object(plan) || !Object.hasOwn(FLOOR_UNITS, plan.unit) || !['blueprint', 'furnished'].includes(plan.style) ||
      ![plan.grid, plan.snap, plan.wallSnap].every(flag) || !number(plan.spacing, 1, 5000) ||
      !Array.isArray(plan.floors) || plan.floors.length < 1 || plan.floors.length > 100) fail('Invalid floor plan.');
  const floors = new Set();
  const coord = value => number(value, -PLAN_LIMIT, PLAN_LIMIT);
  for (const floor of plan.floors) {
    if (!object(floor) || !isId(floor.id) || floors.has(floor.id) || !string(floor.name, 160) || !floor.name.trim() ||
      !object(floor.points) || !Array.isArray(floor.objects)) fail('Invalid floor.');
    floors.add(floor.id);
    const points = floor.points;
    for (const [id, p] of Object.entries(points)) {
      if (!isId(id) || !object(p) || !coord(p.x) || !coord(p.y)) fail('Invalid floor point.');
    }
    const ids = new Set(), walls = new Set(), openings = [];
    const vertex = id => isId(id) && Object.hasOwn(points, id);
    for (const item of floor.objects) {
      if (!object(item) || !isId(item.id) || ids.has(item.id)) fail('Invalid floor object.');
      ids.add(item.id);
      if (item.type === 'wall') {
        if (!vertex(item.a) || !vertex(item.b) || Math.hypot(points[item.a].x - points[item.b].x, points[item.a].y - points[item.b].y) < 1 ||
          !number(item.thickness, 1, 500)) fail('Invalid wall.');
        walls.add(item.id);
      } else if (item.type === 'room') {
        if (!Array.isArray(item.vertices) || item.vertices.length < 3 || new Set(item.vertices).size !== item.vertices.length ||
          !item.vertices.every(vertex) || !string(item.name, 160) || !validColor(item.color) ||
          !['plain', 'wood', 'tile'].includes(item.surface)) fail('Invalid room.');
      } else {
        if (item.type === 'furniture') {
          if (item.variant === 'custom') validateFurnitureDesign(item.design);
          else if (!furnitureDefinition(item.variant)) fail('Unknown furniture type.');
        } else if (!Object.hasOwn(FLOOR_ITEMS, item.type) || !Object.hasOwn(FLOOR_ITEMS[item.type], item.variant)) fail('Invalid floor object type.');
        if (item.type === 'door' || item.type === 'window') {
          if (!number(item.at, 0, 1) || !number(item.width, 1, 5000) ||
            !['left-in', 'right-in', 'left-out', 'right-out'].includes(item.swing)) fail('Invalid opening.');
          openings.push(item);
        } else if (!coord(item.x) || !coord(item.y) || !number(item.w, 1, PLAN_LIMIT) || !number(item.h, 1, PLAN_LIMIT) ||
          !number(item.angle, -360, 360) || !string(item.name, 160) || !validColor(item.color)) fail('Invalid floor object geometry.');
      }
    }
    if (openings.some(item => !walls.has(item.wall))) fail('A floor opening is missing its wall.');
  }
  if (!floors.has(plan.active)) fail('The selected floor is missing.');
}

export function validateProject(project) {
  if (!object(project) || project.schema !== SCHEMA) fail('This project schema is unsupported.');
  if (!isId(project.id) || !isId(project.root) || !string(project.title, 160) || !project.title.trim() ||
      !number(project.createdAt, 0, 8.64e15) || !object(project.boards) || !project.boards[project.root] ||
      !object(project.settings) || !flag(project.settings.grid) || !flag(project.settings.guides)) fail('Invalid project metadata.');
  if (project.variables !== undefined && (!object(project.variables) ||
    !Object.entries(project.variables).every(([key, value]) => VARIABLE_NAME.test(key) && string(value, 4000)))) fail('Invalid project variables.');
  const allIds = new Set([project.id]);
  const claim = key => {
    if (!isId(key) || allIds.has(key)) fail('Invalid or repeated project ID.');
    allIds.add(key);
  };
  const owned = new Set([project.root]);
  const pending = [project.root];
  while (pending.length) {
    const key = pending.pop();
    const board = project.boards[key];
    claim(key);
    if (!object(board) || board.id !== key || !Array.isArray(board.elements) || !Array.isArray(board.connections)) fail('Invalid canvas.');
    if (board.kind !== undefined && !['map', 'timeline'].includes(board.kind)) fail('Invalid workspace.');
    if (board.plan !== undefined) {
      if (board.kind !== 'map' || board.elements.length || board.connections.length || board.background !== undefined) fail('Invalid floor plan workspace.');
      validateFloorPlan(board.plan);
    }
    if (board.timeline !== undefined) {
      const settings = board.timeline;
      if (board.kind !== 'timeline' || !object(settings) || !number(settings.scale, .1, 20) ||
          !Object.hasOwn(DATE_ORDERS, settings.order) || !Object.hasOwn(DATE_SEPARATORS, settings.separator) ||
          !Object.hasOwn(MONTH_FORMATS, settings.month) || !['12', '24'].includes(settings.clock) ||
          ![settings.dateZero, settings.hourZero, settings.seconds].every(flag)) fail('Invalid timeline settings.');
    }
    const layers = boardLayers(board);
    if (!Array.isArray(layers) || !layers.some(layer => layer?.id === 'default')) fail('A default layer is required.');
    const layerIds = new Set();
    for (const layer of layers) {
      if (!object(layer) || !string(layer.title, 160) || !flag(layer.hidden) || !flag(layer.locked) || layerIds.has(layer.id)) fail('Invalid layer.');
      if (layer.id !== 'default') claim(layer.id);
      layerIds.add(layer.id);
    }
    const elementIds = new Set();
    for (const element of board.elements) {
      if (!object(element)) fail('Invalid element.');
      claim(element.id);
      elementIds.add(element.id);
      const { type, x, y, w, h, title, fill, color } = element;
      if (!TYPES.includes(type) || !number(x, -WORLD, WORLD) || !number(y, -WORLD, WORLD) ||
          !number(w, 24, WORLD) || !number(h, 24, WORLD) || !optionalColor(fill) || !optionalColor(color)) fail('Invalid element geometry or style.');
      if ([...WORKSPACES, 'note', 'list', 'stack', 'marker', 'event'].includes(type) && !string(title, 160)) fail('Invalid element title.');
      if (!layerIds.has(layerId(element))) fail('An element is assigned to a missing layer.');
      if (type === 'stack' && (!STACK_LAYOUTS.includes(element.layout) || !flag(element.expanded))) fail('Invalid stack.');
      if ((type === 'reference' && !isId(element.targetId)) || (element.targetId !== undefined && !isId(element.targetId))) fail('Invalid element link.');
      if (type === 'event' && (!string(element.description, 12000) || !string(element.date, 160) || !string(element.time, 40) ||
        (element.endDate !== undefined && !string(element.endDate, 160)) || (element.endTime !== undefined && !string(element.endTime, 40)) ||
        (element.dateMode !== undefined && !['calendar', 'fictional'].includes(element.dateMode)) ||
        (element.timelineOffset !== undefined && !number(element.timelineOffset, -WORLD, WORLD)) ||
        !number(element.duration, 0, 1e7) || (element.chronology !== null && !number(element.chronology, -1e9, 1e9)))) fail('Invalid timeline event.');
      if (WORKSPACES.includes(type)) {
        if (!isId(element.boardId) || owned.has(element.boardId)) fail('The canvas hierarchy contains a cycle or shared child.');
        if (project.boards[element.boardId]?.kind !== (type === 'canvas' ? undefined : type)) fail('Invalid workspace type.');
        owned.add(element.boardId);
        pending.push(element.boardId);
      }
      if (type === 'text' || type === 'note') {
        if (!string(element.html, 500_000) || !FONTS.includes(element.font) || !number(element.size, 8, 120) ||
            !['left', 'center', 'right', 'justify'].includes(element.align) || (type === 'note' && !flag(element.border))) fail('Invalid text formatting.');
      }
      if (type === 'list') {
        if (!LISTS.includes(element.kind) || !Array.isArray(element.items)) fail('Invalid list.');
        for (const item of element.items) {
          if (!object(item) || !string(item.text, 4000) || !flag(item.done)) fail('Invalid list item.');
          claim(item.id);
        }
      }
      if (MEDIA_TYPES.includes(type)) {
        const { asset, name, mime, ratio, duration } = element;
        const validMedia = asset === undefined
          ? [name, mime, ratio, duration].every(value => value === undefined)
          : isId(asset) && string(name, 500) && string(mime, 100) && mime.startsWith(type + '/') &&
            (ratio === undefined || number(ratio, 0.001, 1000)) &&
            (duration === undefined || number(duration, 0, 1e9));
        if (!validMedia) fail('Invalid media element.');
      }
      if (type === 'shape' && (!SHAPES.includes(element.shape) || !validColor(element.stroke) ||
          !number(element.weight, 0, 24) || !number(element.opacity, 0, 1) || !number(element.angle, -360, 360))) fail('Invalid shape.');
    }
    const stacks = new Set(board.elements.filter(model => model.type === 'stack').map(model => model.id));
    for (const element of board.elements) {
      if (element.stackId !== undefined && !stacks.has(element.stackId)) fail('Invalid stack membership.');
    }
    const { roots, children } = stackTree(board.elements, false);
    let reachable = 0;
    for (const model of stackWalk(roots, children)) reachable++;
    if (reachable !== board.elements.length) fail('Stack containment contains a cycle.');
    if (board.background !== undefined && (board.kind !== 'map' || !board.elements.some(element => element.id === board.background && element.type === 'image'))) fail('Invalid map image.');
    for (const link of board.connections) {
      if (!object(link)) fail('Invalid connection.');
      claim(link.id);
      if (link.label !== undefined && (!object(link.label) || !string(link.label.text, 500) ||
        !number(link.label.size, 8, 72) || !validColor(link.label.color) || !flag(link.label.hidden))) fail('Invalid connection label.');
      if (!elementIds.has(link.from) || !elementIds.has(link.to) || link.from === link.to || !validColor(link.color) ||
          !['solid', 'dashed', 'dotted'].includes(link.style) || !flag(link.arrow)) fail('Invalid connection.');
    }
  }
  const references = new Set([...projectElements(project)].filter(element => element.type === 'reference').map(element => element.id));
  for (const element of projectElements(project)) {
    if (references.has(element.id) && references.has(element.targetId)) fail('A reference must point to an original element.');
  }
  if (owned.size !== Object.keys(project.boards).length) fail('The project contains orphaned canvases.');
  if (!object(project.view) || !owned.has(project.view.active) || !object(project.view.byBoard)) fail('Invalid project navigation.');
  for (const [key, view] of Object.entries(project.view.byBoard)) {
    if (!owned.has(key) || !object(view) || !number(view.x, -WORLD * 10, WORLD * 10) || !number(view.y, -WORLD * 10, WORLD * 10) ||
        !number(view.zoom, 0.00001, 6)) fail('Invalid canvas viewport.');
  }
  return project;
}
