import { boardLayers, layerId } from './model.js';
import { stackFamily, stackTree, stackWalk } from './stack-tree.js';
import { timelinePositions, timelineSettings } from './timeline.js';

const indexes = new WeakMap();
export function elementIndex(project) {
  if (!indexes.has(project.boards)) {
    indexes.set(project.boards, new Map(Object.values(project.boards).flatMap(board =>
      board.elements.map(model => [model.id, { board, model }]))));
  }
  return indexes.get(project.boards);
}

const accessors = new WeakMap();
function stackAccess(board) {
  if (accessors.has(board)) return accessors.get(board);
  const layers = new Map(boardLayers(board).map(layer => [layer.id, layer]));
  const { roots, children } = stackTree(board.elements);
  const entries = new Map(), lockedSubtrees = new Set();
  const ordered = [...stackWalk(roots, children)];
  for (const model of ordered) {
    const own = layers.get(layerId(model)), parent = entries.get(model.stackId);
    const entry = { hidden: Boolean(own?.hidden || parent?.hidden),
      locked: Boolean(own?.locked || parent?.locked || model.id === board.background) };
    entries.set(model.id, entry);
    if (entry.locked) lockedSubtrees.add(model.id);
  }
  for (const model of ordered.reverse()) {
    if (model.stackId && lockedSubtrees.has(model.id)) lockedSubtrees.add(model.stackId);
  }
  const access = { entries, lockedSubtrees };
  accessors.set(board, access);
  return access;
}
export const layerAccess = board => model => stackAccess(board).entries.get(model.id);
export const lockedSubtree = (board, id) => stackAccess(board).lockedSubtrees.has(id);

export const stackOpen = model => model.layout !== 'collapsed' || model.expanded;
const padding = 14, header = 43, gap = 12;

function stackGeometry(ordered, children) {
  const shapes = new Map(), offsets = new Map();
  for (let index = ordered.length - 1; index >= 0; index--) {
    const model = ordered[index];
    if (model.type !== 'stack') continue;
    const members = children.get(model.id) ?? [];
    const shape = { ...model, count: members.length };
    shapes.set(model.id, shape);
    if (!stackOpen(model)) continue;
    const layout = model.layout === 'collapsed' ? 'vertical' : model.layout;
    let x = padding, y = header, row = 0;
    for (const child of members) {
      const { w, h } = shapes.get(child.id) ?? child;
      if (layout === 'grid' && row && x + w > model.w - padding) {
        x = padding;
        y += row + gap;
        row = 0;
      }
      offsets.set(child.id, { x, y });
      shape.w = Math.max(shape.w, x + w + padding);
      shape.h = Math.max(shape.h, y + h + padding);
      if (layout === 'vertical') y += h + gap;
      else { x += w + gap; row = Math.max(row, h); }
    }
  }
  return { shapes, offsets };
}

const presentations = new WeakMap();
export function presentBoard(board, floating) {
  if (!floating?.size && presentations.has(board)) return presentations.get(board);
  const access = layerAccess(board), layers = boardLayers(board);
  const order = new Map(layers.map((layer, index) => [layer.id, index]));
  const visible = board.elements.filter(model => !access(model).hidden);
  const { roots, children } = stackTree(floating?.size ? visible.map(model =>
    floating.has(model.id) ? { ...model, stackId: undefined } : model) : visible);
  const z = model => model.id === board.background ? -1 : order.get(layerId(model));
  const ordered = [...stackWalk([...roots].sort((a, b) => z(a) - z(b)), children)];
  const { shapes, offsets } = stackGeometry(ordered, children);
  const timeline = board.kind === 'timeline' ? timelinePositions(visible, timelineSettings(board)) : null;
  const elements = [], displayed = new Map(), anchors = new Map();
  for (const model of ordered) {
    const parent = displayed.get(model.stackId);
    const anchor = anchors.get(model.stackId) ?? (parent?.type === 'stack' && !stackOpen(parent) ? parent.id : undefined);
    if (anchor) {
      anchors.set(model.id, anchor);
      continue;
    }
    const shape = shapes.get(model.id) ?? timeline?.get(model.id) ?? model;
    const offset = offsets.get(model.id);
    const item = offset ? { ...shape, x: parent.x + offset.x, y: parent.y + offset.y } : shape;
    displayed.set(model.id, item);
    elements.push(item);
  }
  const connections = board.connections.flatMap(link => {
    const from = anchors.get(link.from) ?? link.from, to = anchors.get(link.to) ?? link.to;
    if (from === to || !displayed.has(from) || !displayed.has(to)) return [];
    return [from === link.from && to === link.to ? link : { ...link, from, to }];
  });
  const result = { ...board, elements, connections };
  if (!floating?.size) presentations.set(board, result);
  return result;
}

export function placeInStack(elements, moved, target, position, displayed) {
  const moving = elements.filter(model => moved.has(model.id));
  if (!moving.length || target && stackFamily(elements, moved).has(target.id)) return elements;
  if (!target) return elements.map(model => moved.has(model.id) && model.stackId ? { ...model, stackId: undefined } : model);
  const horizontal = target.layout === 'horizontal';
  const grid = target.layout === 'grid';
  const before = displayed.find(model => model.stackId === target.id && !moved.has(model.id) &&
    (horizontal ? position.x < model.x + model.w / 2 :
      grid ? position.y < model.y || position.y < model.y + model.h && position.x < model.x + model.w / 2 :
      position.y < model.y + model.h / 2));
  const next = elements.filter(model => !moved.has(model.id));
  const index = before ? next.findIndex(model => model.id === before.id) : next.length;
  return [...next.slice(0, index), ...moving.map(model => ({ ...model, stackId: target.id })), ...next.slice(index)];
}
