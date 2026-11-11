export const SCHEMA = 1;
export const ACCENT = '#B58A35';
export const WORLD = 10_000_000;
export const MEDIA_TYPES = ['image', 'audio', 'video'];
export const TYPES = ['text', 'note', 'list', 'image', 'audio', 'video', 'shape', 'canvas'];
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

export const SIZE = {
  text: [260, 150], note: [250, 200], list: [260, 200], image: [300, 200],
  audio: [315, 110], video: [320, 205], shape: [160, 115], canvas: [220, 100],
};
export const LABEL = {
  text: 'Text', note: 'Note', list: 'List', image: 'Image', audio: 'Audio', video: 'Video',
  shape: 'Shape', canvas: 'Nested Canvas',
};
export const ICON = { text: 'T', note: '▤', list: '☷', image: '▧', audio: '♫', video: '▷', shape: '◇', canvas: '▦' };

export function makeElement(type, x, y, options = {}) {
  const [w, h] = SIZE[type];
  const element = { id: id(), type, x: point(x), y: point(y), w, h };
  if (type === 'text' || type === 'note') {
    Object.assign(element, { html: '', font: 'System', size: 16, align: 'left' });
    if (type === 'note') Object.assign(element, { title: 'Untitled Note', border: true });
  }
  if (type === 'list') Object.assign(element, { title: 'Untitled List', kind: 'checklist', items: [] });
  if (type === 'shape') Object.assign(element, { shape: 'rectangle', fill: ACCENT, stroke: '#83601e', weight: 2, opacity: 1, angle: 0 });
  if (type === 'canvas') Object.assign(element, { title: 'Untitled Canvas', boardId: id() });
  return { ...element, ...options };
}

export function updateBoard(project, board) {
  return { ...project, boards: { ...project.boards, [board.id]: board } };
}

export function insertElement(project, boardId, element) {
  const board = project.boards[boardId];
  const next = updateBoard(project, { ...board, elements: [...board.elements, element] });
  if (element.type === 'canvas') next.boards[element.boardId] = { id: element.boardId, elements: [], connections: [] };
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
      if (element.type === 'canvas') pending.push(element.boardId);
    }
  }
}

export function parents(project) {
  const map = new Map();
  for (const board of Object.values(project.boards)) {
    for (const element of board.elements) if (element.type === 'canvas') map.set(element.boardId, { board: board.id, element });
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
    elements: board.elements.filter(element => !ids.has(element.id)),
    connections: board.connections.filter(connection => connection.id !== connectionId && !ids.has(connection.from) && !ids.has(connection.to)),
  });
  for (const child of descendants(project.boards, removed.filter(element => element.type === 'canvas').map(element => element.boardId))) {
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
  const elements = board.elements.filter(element => ids.has(element.id));
  const connections = board.connections.filter(connection => ids.has(connection.from) && ids.has(connection.to));
  const children = [...descendants(project.boards, elements.filter(element => element.type === 'canvas').map(element => element.boardId))];
  const boards = Object.fromEntries(children.map(child => [child.id, child]));
  const views = Object.fromEntries(children.filter(child => project.view.byBoard[child.id]).map(child => [child.id, project.view.byBoard[child.id]]));
  return { elements, connections, boards, views };
}

export function insertSelection(project, boardId, fragment, dx, dy) {
  const board = project.boards[boardId];
  const boardIds = new Map(Object.keys(fragment.boards).map(key => [key, id()]));
  const cloneContent = (source, offsetX, offsetY) => {
    const ids = new Map();
    const elements = source.elements.map(element => {
      const key = id();
      ids.set(element.id, key);
      const copy = { ...element, id: key, x: point(element.x + offsetX), y: point(element.y + offsetY) };
      if (copy.type === 'canvas') copy.boardId = boardIds.get(copy.boardId);
      if (copy.type === 'list') copy.items = copy.items.map(item => ({ ...item, id: id() }));
      return copy;
    });
    const connections = source.connections.map(link => ({ ...link, id: id(), from: ids.get(link.from), to: ids.get(link.to) }));
    return { elements, connections };
  };
  const content = cloneContent(fragment, dx, dy);
  const next = updateBoard(project, {
    ...board, elements: [...board.elements, ...content.elements], connections: [...board.connections, ...content.connections],
  });
  const byBoard = { ...project.view.byBoard };
  for (const child of Object.values(fragment.boards)) {
    const key = boardIds.get(child.id);
    next.boards[key] = { id: key, ...cloneContent(child, 0, 0) };
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

const fail = message => { throw new Error(message); };
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const string = (value, max) => typeof value === 'string' && value.length <= max;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const flag = value => typeof value === 'boolean';
const optionalColor = value => value === undefined || validColor(value);

export function validateProject(project) {
  if (!object(project) || project.schema !== SCHEMA) fail('This project schema is unsupported.');
  if (!isId(project.id) || !isId(project.root) || !string(project.title, 160) || !project.title.trim() ||
      !number(project.createdAt, 0, 8.64e15) || !object(project.boards) || !project.boards[project.root] ||
      !object(project.settings) || !flag(project.settings.grid) || !flag(project.settings.guides)) fail('Invalid project metadata.');
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
    const elementIds = new Set();
    for (const element of board.elements) {
      if (!object(element)) fail('Invalid element.');
      claim(element.id);
      elementIds.add(element.id);
      const { type, x, y, w, h, title, fill, color } = element;
      if (!TYPES.includes(type) || !number(x, -WORLD, WORLD) || !number(y, -WORLD, WORLD) ||
          !number(w, 24, WORLD) || !number(h, 24, WORLD) || !optionalColor(fill) || !optionalColor(color)) fail('Invalid element geometry or style.');
      if (['canvas', 'note', 'list'].includes(type) && !string(title, 160)) fail('Invalid element title.');
      if (type === 'canvas') {
        if (!isId(element.boardId) || owned.has(element.boardId)) fail('The canvas hierarchy contains a cycle or shared child.');
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
    for (const link of board.connections) {
      if (!object(link)) fail('Invalid connection.');
      claim(link.id);
      if (!elementIds.has(link.from) || !elementIds.has(link.to) || link.from === link.to || !validColor(link.color) ||
          !['solid', 'dashed', 'dotted'].includes(link.style) || !flag(link.arrow)) fail('Invalid connection.');
    }
  }
  if (owned.size !== Object.keys(project.boards).length) fail('The project contains orphaned canvases.');
  if (!object(project.view) || !owned.has(project.view.active) || !object(project.view.byBoard)) fail('Invalid project navigation.');
  for (const [key, view] of Object.entries(project.view.byBoard)) {
    if (!owned.has(key) || !object(view) || !number(view.x, -WORLD * 10, WORLD * 10) || !number(view.y, -WORLD * 10, WORLD * 10) ||
        !number(view.zoom, 0.00001, 6)) fail('Invalid canvas viewport.');
  }
  return project;
}
