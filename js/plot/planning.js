import { boardLayers, layerId, point, WORKSPACES } from './model.js';

const indexes = new WeakMap();
export function elementIndex(project) {
  if (!indexes.has(project.boards)) {
    indexes.set(project.boards, new Map(Object.values(project.boards).flatMap(board =>
      board.elements.map(model => [model.id, { board, model }]))));
  }
  return indexes.get(project.boards);
}

const accessors = new WeakMap();
export function layerAccess(board) {
  if (accessors.has(board)) return accessors.get(board);
  const layers = new Map(boardLayers(board).map(layer => [layer.id, layer]));
  const stacks = new Map(board.elements.filter(model => model.type === 'stack').map(model => [model.id, layers.get(layerId(model))]));
  const access = model => {
    const own = layers.get(layerId(model)), container = stacks.get(model.stackId);
    return {
      hidden: Boolean(own?.hidden || container?.hidden),
      locked: Boolean(own?.locked || container?.locked || model.id === board.background),
    };
  };
  accessors.set(board, access);
  return access;
}

export const canStack = model => !WORKSPACES.includes(model.type) && !['stack', 'marker', 'event'].includes(model.type);
export const stackOpen = model => model.layout !== 'collapsed' || model.expanded;
const stackPadding = 14, stackHeader = 43, gap = 12;
const step = 246, timelineStart = 70;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function eventChronology(event) {
  if (event.chronology !== null) return event.chronology;
  if (!datePattern.test(event.date)) return null;
  const time = timePattern.test(event.time) ? event.time : '00:00';
  const parsed = new Date(`${event.date}T${time}:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === event.date ? parsed.valueOf() / 86400000 : null;
}

function timelineGeometry(elements) {
  const dated = [], undated = [];
  for (const model of elements) {
    if (model.type !== 'event') continue;
    const day = eventChronology(model);
    (day === null ? undated : dated).push({ model, day });
  }
  dated.sort((a, b) => a.day - b.day || a.model.x - b.model.x);
  undated.sort((a, b) => a.model.x - b.model.x);
  const positions = new Map();
  const positionRow = (row, y) => {
    let x = timelineStart, previous;
    for (const { model, day } of row) {
      if (previous) x += Math.max(step, previous.model.w + 24) + (day === null ? 0 : Math.min(460, Math.log1p(Math.max(0, day - previous.day)) * 62));
      positions.set(model.id, { ...model, x: point(x), y });
      previous = { model, day };
    }
  };
  positionRow(dated, 95);
  positionRow(undated, 120 + dated.reduce((height, { model }) => Math.max(height, model.h), 166));
  return positions;
}

export function moveTimelineEvent(model, peers) {
  const day = eventChronology(model);
  if (day === null) return model;
  const others = peers.filter(item => item.type === 'event' && item.id !== model.id && eventChronology(item) !== null)
    .sort((a, b) => a.x - b.x);
  if (!others.length) return model;
  const old = peers.find(item => item.id === model.id);
  const center = model.x + model.w / 2;
  const nextIndex = others.findIndex(item => center < item.x + item.w / 2);
  const previousIndex = others.findIndex(item => old.x < item.x);
  if (nextIndex === previousIndex) return model;
  const before = nextIndex === -1 ? others.at(-1) : others[nextIndex - 1];
  const after = nextIndex === -1 ? undefined : others[nextIndex];
  const low = before && eventChronology(before), high = after && eventChronology(after);
  const chronology = before && after ? (low + high) / 2 : before ? low + 1 : high - 1;
  if (model.chronology === null && datePattern.test(model.date)) {
    const stamp = new Date(Math.round(chronology * 1440) * 60000);
    if (Number.isFinite(stamp.valueOf()) && stamp.getUTCFullYear() >= 0 && stamp.getUTCFullYear() <= 9999) {
      const iso = stamp.toISOString();
      return { ...model, date: iso.slice(0, 10), time: iso.slice(11, 16) };
    }
  }
  return { ...model, chronology: Math.max(-1e9, Math.min(1e9, chronology)) };
}

const presentations = new WeakMap();
export function presentBoard(board, floating) {
  if (!floating && presentations.has(board)) return presentations.get(board);
  const access = layerAccess(board), layers = boardLayers(board);
  const order = new Map(layers.map((layer, index) => [layer.id, index]));
  const children = new Map(), projected = new Map(), anchors = new Map(), byId = new Map(board.elements.map(model => [model.id, model]));
  const visible = board.elements.filter(model => !access(model).hidden);
  for (const model of visible) {
    if (!model.stackId || floating?.has(model.id)) continue;
    if (!children.has(model.stackId)) children.set(model.stackId, []);
    children.get(model.stackId).push(model);
  }
  for (const model of visible) {
    if (model.type !== 'stack') continue;
    const members = children.get(model.id) ?? [];
    const open = stackOpen(model);
    if (!open) {
      projected.set(model.id, { ...model, count: members.length });
      for (const child of members) anchors.set(child.id, model.id);
      continue;
    }
    const layout = model.layout === 'collapsed' ? 'vertical' : model.layout;
    let x = model.x + stackPadding, y = model.y + stackHeader, row = 0;
    let right = x, bottom = y;
    for (const child of members) {
      if (layout === 'grid' && row && x + child.w > model.x + model.w - stackPadding) {
        x = model.x + stackPadding;
        y += row + gap;
        row = 0;
      }
      projected.set(child.id, { ...child, x: point(x), y: point(y) });
      right = Math.max(right, x + child.w);
      bottom = Math.max(bottom, y + child.h);
      if (layout === 'vertical') y += child.h + gap;
      else { x += child.w + gap; row = Math.max(row, child.h); }
    }
    projected.set(model.id, { ...model, w: Math.max(model.w, right - model.x + stackPadding),
      h: Math.max(model.h, bottom - model.y + stackPadding), count: members.length });
  }
  const timeline = board.kind === 'timeline' ? timelineGeometry(visible) : null;
  const z = model => order.get(layerId(byId.get(model.stackId) ?? model));
  const elements = visible.filter(model => !anchors.has(model.id))
    .sort((a, b) => a.id === board.background ? -1 : b.id === board.background ? 1 :
      z(a) - z(b) || Boolean(a.stackId) - Boolean(b.stackId))
    .map(model => floating?.has(model.id) ? model : projected.get(model.id) ?? timeline?.get(model.id) ?? model);
  const shown = new Set(elements.map(model => model.id));
  const connections = board.connections.flatMap(link => {
    const from = anchors.get(link.from) ?? link.from, to = anchors.get(link.to) ?? link.to;
    if (from === to || !shown.has(from) || !shown.has(to)) return [];
    return [from === link.from && to === link.to ? link : { ...link, from, to }];
  });
  const result = { ...board, elements, connections };
  if (!floating) presentations.set(board, result);
  return result;
}

export function placeInStack(elements, moved, target, position, displayed) {
  const moving = elements.filter(model => moved.has(model.id) && canStack(model));
  if (!moving.length) return elements;
  if (!target) return elements.map(model => moved.has(model.id) && model.stackId ? { ...model, stackId: undefined } : model);
  const horizontal = target.layout === 'horizontal';
  const grid = target.layout === 'grid';
  const before = displayed.find(model => model.stackId === target.id && !moved.has(model.id) &&
    (horizontal ? position.x < model.x + model.w / 2 :
      grid ? position.y < model.y || position.y < model.y + model.h && position.x < model.x + model.w / 2 :
      position.y < model.y + model.h / 2));
  const movingIds = new Set(moving.map(model => model.id));
  const next = elements.filter(model => !movingIds.has(model.id));
  next.splice(before ? next.findIndex(model => model.id === before.id) : next.length, 0,
    ...moving.map(model => ({ ...model, stackId: target.id })));
  return next;
}
