import { eventSchedule, timelineAxes, timelineSettings } from './timeline.js';
import { $, element, button } from './common.js';
import { ICON, LABEL, MEDIA_TYPES, WORKSPACES } from './model.js';
import { bounds, endpoints, intersects, viewportBounds } from './geometry.js';
import { cleanHTML } from './rich-text.js';
import { elementIndex, layerAccess, stackOpen } from './planning.js';
import { resolveText, transformHTML } from './variables.js';

export const resolvedHTML = (html, variables) => transformHTML(cleanHTML(html), text => resolveText(text, variables));
export function referenceSource(model, project) {
  if (model.type !== 'reference') return undefined;
  const source = elementIndex(project).get(model.targetId)?.model;
  return source?.type !== 'reference' ? source : undefined;
}
export const cardAsset = (model, project) => model.asset ?? referenceSource(model, project)?.asset;

export const SVG = 'http://www.w3.org/2000/svg';
export const svg = (tag, attributes = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};
const FONTS = {
  System: 'system-ui, sans-serif', Georgia: 'Georgia, serif', Arial: 'Arial, sans-serif', 'Courier New': '"Courier New", monospace',
};
export function arrowPoints(from, to, size) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const base = { x: to.x - size * Math.cos(angle), y: to.y - size * Math.sin(angle) };
  const dx = Math.sin(angle) * size * .52, dy = Math.cos(angle) * size * .52;
  return `${to.x},${to.y} ${base.x + dx},${base.y - dy} ${base.x - dx},${base.y + dy}`;
}
export function linkSVG(link, from, to, { scale = 1, hit = false, labelScale = scale, variables } = {}) {
  const group = svg('g', { 'data-connection': link.id });
  const coords = { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  if (hit) group.append(svg('line', { ...coords, class: 'connection-hit', stroke: 'transparent', 'stroke-width': 16 }));
  const path = svg('line', { ...coords, stroke: link.color, 'stroke-width': 2 * scale, 'stroke-linecap': 'round', class: 'connection-visible' });
  if (link.style !== 'solid') path.setAttribute('stroke-dasharray', link.style === 'dashed' ? `${7 * scale} ${5 * scale}` : `${1 * scale} ${5 * scale}`);
  group.append(path);
  if (link.arrow) group.append(svg('polygon', { points: arrowPoints(from, to, 12 * scale), fill: link.color, class: 'connection-visible' }));
  if (link.label?.text && !link.label.hidden) {
    const label = svg('text', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2,
      'font-size': Math.max(7, link.label.size * labelScale), fill: link.label.color, class: 'connection-label' });
    label.textContent = resolveText(link.label.text, variables);
    group.append(label);
  }
  return group;
}
function shapeSVG(model) {
  const { w, h, stroke, weight, fill, shape, opacity } = model;
  const icon = svg('svg', { width: '100%', height: '100%', viewBox: `0 0 ${w} ${h}`, 'aria-hidden': true, opacity });
  const inset = weight / 2 + 1;
  const style = { fill: fill || 'none', stroke, 'stroke-width': weight };
  if (shape === 'ellipse') icon.append(svg('ellipse', { ...style, cx: w / 2, cy: h / 2, rx: w / 2 - inset, ry: h / 2 - inset }));
  else if (shape === 'rectangle' || shape === 'rounded') {
    icon.append(svg('rect', { ...style, x: inset, y: inset, width: w - inset * 2, height: h - inset * 2, rx: shape === 'rounded' ? 15 : 0 }));
  } else {
    const from = { x: inset, y: h - inset }, to = { x: w - inset, y: inset };
    icon.append(svg('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, stroke, 'stroke-width': weight, 'stroke-linecap': 'round' }));
    if (shape === 'arrow') icon.append(svg('polygon', { points: arrowPoints(from, to, 12 + weight), fill: stroke }));
  }
  return icon;
}
export function labelTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function buildList(model, callbacks, exporting, resolve, readOnly) {
  const tag = model.kind === 'numbers' ? 'ol' : 'ul';
  const list = element(tag, 'plot-list ' + model.kind);
  if (!model.items.length) list.append(element('li', 'list-empty', 'Add items in the inspector.'));
  for (const item of model.items) {
    const row = element('li', item.done && model.kind === 'checklist' ? 'done' : '');
    if (model.kind === 'checklist') {
      if (exporting || readOnly) row.append(element('span', 'check-symbol', item.done ? '☑' : '☐'));
      else {
        const input = element('input');
        input.type = 'checkbox';
        input.checked = item.done;
        input.setAttribute('aria-label', item.text || 'Checklist item');
        input.onchange = () => callbacks.toggle(model.id, item.id, input.checked);
        row.append(input);
      }
    }
    row.append(element('span', null, resolve(item.text) || 'New item'));
    list.append(row);
  }
  return list;
}
function mediaPlaceholder(node, model, callbacks, exporting, readOnly) {
  const label = `Upload ${LABEL[model.type]}`;
  const control = exporting || readOnly ? element('div', 'media-upload') : button('', () => callbacks.upload(model), 'media-upload');
  const icon = element('span', 'placeholder-icon', model.type === 'video' ? '▶' : ICON[model.type]);
  icon.setAttribute('aria-hidden', 'true');
  control.append(icon);
  if (model.type === 'audio') {
    const wave = element('span', 'placeholder-wave');
    wave.setAttribute('aria-hidden', 'true');
    for (const height of [6, 12, 18, 9, 23, 15, 8, 18, 12, 6]) {
      const bar = element('i');
      bar.style.height = `${height}px`;
      wave.append(bar);
    }
    control.append(wave);
  }
  control.append(element('span', 'placeholder-label', label));
  if (!exporting && !readOnly) {
    const grip = element('span', 'placeholder-grip', '⠿');
    grip.title = 'Move media card';
    grip.setAttribute('aria-hidden', 'true');
    node.append(grip);
  }
  node.append(control);
}

function mediaContents(node, model, callbacks, exporting, readOnly) {
  node.classList.toggle('media-empty', !model.asset);
  if (!model.asset) return mediaPlaceholder(node, model, callbacks, exporting, readOnly);

  if (model.type === 'audio' || model.type === 'video' && exporting) {
    const title = element('div', 'media-title');
    title.append(element('span', 'element-icon', ICON[model.type]), element('strong', null, model.name));
    const meta = element('small', 'media-meta', model.duration === undefined ? LABEL[model.type] : labelTime(model.duration));
    node.append(title, meta);
    if (exporting) {
      if (model.type === 'video') {
        const poster = element('img', 'media-player');
        poster.alt = '';
        callbacks.poster?.(model).then(url => { if (url) poster.src = url; }).catch(() => {});
        node.append(poster);
      }
      return;
    }
  }
  if (model.type === 'video') node.append(element('span', 'video-grip', '⠿  ' + model.name));
  const media = element(model.type === 'image' ? 'img' : model.type, 'media-player');
  if (model.type === 'image') { media.alt = model.name; media.draggable = false; }
  else {
    media.controls = true;
    media.preload = 'metadata';
    media.setAttribute('playsinline', '');
    media.onloadedmetadata = () => callbacks.metadata?.(model, media);
  }
  media.onerror = () => {
    if (!media.getAttribute('src') || node.querySelector('.media-error')) return;
    node.append(element('small', 'media-error', 'This file cannot be played on this device.'));
  };
  callbacks.source(model.asset, model.mime).then(url => {
    if (!url) throw new Error('Missing media');
    if (node.contains(media)) media.src = url;
  }).catch(() => { if (node.contains(media)) node.append(element('small', 'media-error', 'Media unavailable')); });
  node.append(media);
  if (!exporting && !readOnly) {
    const replace = button('Replace', () => callbacks.upload(model), 'media-replace');
    replace.setAttribute('aria-label', `Replace ${LABEL[model.type]}`);
    node.append(replace);
  }
}
function contents(node, model, project, callbacks, exporting, readOnly = false) {
  const resolve = text => resolveText(text ?? '', project.variables);
  const board = project.boards[model.boardId];
  node.replaceChildren();
  node.style.backgroundColor = model.fill && model.type !== 'shape' ? model.fill : '';
  node.style.color = model.type === 'marker' || model.type === 'event' ? '' : model.color ?? '';
  node.classList.toggle('borderless', model.border === false);
  if (model.type === 'text' || model.type === 'note') {
    if (model.type === 'note') node.append(element('strong', 'element-title', resolve(model.title) || 'Untitled Note'));
    const text = element('div', 'rich-content');
    text.dataset.placeholder = model.type === 'note' ? 'Double-click to write a note' : 'Double-click to add text';
    text.style.fontFamily = FONTS[model.font];
    text.style.fontSize = `${model.size}px`;
    text.style.textAlign = model.align;
    text.innerHTML = resolvedHTML(model.html, project.variables);
    node.append(text);
  } else if (model.type === 'list') {
    node.append(element('strong', 'element-title', resolve(model.title) || 'Untitled List'), buildList(model, callbacks, exporting, resolve, readOnly));
  } else if (WORKSPACES.includes(model.type)) {
    const label = element('div', 'nested-label');
    label.append(element('strong', 'element-title', resolve(model.title)),
      element('small', null, board?.plan ? `${board.plan.floors.length} ${board.plan.floors.length === 1 ? 'floor' : 'floors'}` :
        `${board?.elements.length ?? 0} ${board?.elements.length === 1 ? 'element' : 'elements'}`));
    node.append(element('span', 'nested-icon', ICON[model.type]), label, element('span', 'nested-arrow', '↗'));
  } else if (model.type === 'stack') {
    const header = element('div', 'stack-header');
    header.append(element('strong', 'element-title', resolve(model.title)), element('small', null, `${model.count ?? 0} cards`));
    if (!readOnly && !exporting && model.layout === 'collapsed') {
      header.append(button(model.expanded ? 'Collapse' : 'Expand', () => callbacks.toggleStack(model.id), 'stack-toggle'));
    }
    node.classList.toggle('stack-closed', !stackOpen(model));
    node.append(header);
  } else if (model.type === 'reference') {
    const source = referenceSource(model, project);
    const header = element('div', 'reference-header');
    header.append(element('small', null, source ? 'REFERENCE' : 'ORIGINAL UNAVAILABLE'));
    if (source && !exporting) header.append(button('Go to Original', () => callbacks.goTo(model.targetId), 'quiet-button'));
    node.append(header);
    if (source) {
      const preview = element('div', `reference-preview element-${source.type}`);
      contents(preview, { ...source, w: Math.max(24, model.w - 20), h: Math.max(24, model.h - 44) }, project, callbacks, exporting, true);
      node.append(preview);
    }
  } else if (model.type === 'marker' || model.type === 'event') {
    node.style.setProperty('--card-color', model.color ?? '#B58A35');
    const heading = element('strong', 'element-title', resolve(model.title));
    node.append(heading);
    if (model.type === 'event') {
      const owner = elementIndex(project).get(model.id)?.board;
      const when = eventSchedule(model, timelineSettings(owner), resolve);
      const details = model.duration ? `${when} · ${model.duration}h` : when;
      const schedule = element('small', 'planning-date', details);
      schedule.title = details;
      node.title = details;
      node.append(schedule);
      if (model.description) node.append(element('p', 'planning-description', resolve(model.description)));
    }
    const target = model.targetId && elementIndex(project).get(model.targetId);
    if (model.targetId && !exporting && !readOnly) node.append(target
      ? button('Open linked element', () => callbacks.goTo(model.targetId), 'quiet-button planning-link')
      : element('small', 'planning-date', 'Linked element unavailable'));
  } else if (model.type === 'shape') node.append(shapeSVG(model));
  else mediaContents(node, model, callbacks, exporting, readOnly);
}

export function updateGeometry(node, model) {
  const { x, y, w, h, angle } = model;
  Object.assign(node.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, transform: angle ? `rotate(${angle}deg)` : '' });
}

export function makeCard(model, project, callbacks, exporting = false) {
  const node = element('div', `plot-element element-${model.type}`);
  node.dataset.element = model.id;
  node.dataset.type = model.type;
  node.setAttribute('aria-label', resolveText(model.title || model.name || LABEL[model.type], project.variables));
  updateGeometry(node, model);
  contents(node, model, project, callbacks, exporting);
  return node;
}

function reviseCard(node, old, model, project, callbacks, editing, refreshText) {
  if (old.x !== model.x || old.y !== model.y || old.w !== model.w || old.h !== model.h || old.angle !== model.angle) updateGeometry(node, model);
  if (editing) {
    const text = node.querySelector('.rich-content');
    text.style.fontFamily = FONTS[model.font];
    text.style.fontSize = `${model.size}px`;
    text.style.textAlign = model.align;
    node.style.color = model.color ?? '';
    node.style.backgroundColor = model.fill ?? '';
    node.classList.toggle('borderless', model.border === false);
    const title = node.querySelector('.element-title');
    if (title) title.textContent = resolveText(model.title || 'Untitled Note', project.variables);
    return;
  }
  node.setAttribute('aria-label', resolveText(model.title || model.name || LABEL[model.type], project.variables));
  const { x, y, w, h, angle, ...before } = old;
  const { x: nx, y: ny, w: nw, h: nh, angle: na, ...after } = model;
  if (refreshText || Object.keys(after).some(key => before[key] !== after[key]) || Object.keys(before).length !== Object.keys(after).length ||
      model.type === 'shape' && (w !== nw || h !== nh)) {
    // Metadata updates must leave native media controls and playback intact.
    if (MEDIA_TYPES.includes(model.type) && old.asset === model.asset) {
      const meta = node.querySelector('.media-meta');
      if (meta && model.duration !== undefined) meta.textContent = labelTime(model.duration);
    } else contents(node, model, project, callbacks, false);
  }
}

export function createCanvasRenderer(callbacks) {
  const canvas = $('plot-canvas'), stage = $('plot-stage'), links = $('plot-links');
  const nodes = new Map();
  let lastOrder = [], active, frame = 0, state;
  function unload(entry) {
    const player = entry.node.querySelector('audio, video');
    if (player) {
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (entry.asset) callbacks.release(entry.asset);
  }
  const forget = key => {
    const entry = nodes.get(key);
    if (!entry) return;
    entry.node.remove();
    unload(entry);
    nodes.delete(key);
  };
  function paint() {
    frame = 0;
    const { project, board, view, selected, linkId, editing, guides, marquee, connecting, stackTarget } = state;
    const { clientWidth: width, clientHeight: height } = canvas;
    if (active !== board.id) {
      for (const key of nodes.keys()) forget(key);
      lastOrder = [];
      active = board.id;
    }
    stage.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
    const spacing = 24 * view.zoom;
    const interval = spacing < 12 ? spacing * 2 ** Math.ceil(Math.log2(12 / spacing)) : spacing;
    canvas.classList.toggle('grid-on', project.settings.grid);
    canvas.style.backgroundSize = `${interval}px ${interval}px`;
    canvas.style.backgroundPosition = `${view.x % interval}px ${view.y % interval}px`;
    const visible = viewportBounds(view, width, height);
    const modelById = new Map();
    const access = layerAccess(project.boards[board.id]);
    const order = [];
    for (const model of board.elements) {
      modelById.set(model.id, model);
      let entry = nodes.get(model.id);
      const media = entry?.node.querySelector('audio, video');
      const keepAlive = media && !media.paused;
      if (editing !== model.id && !keepAlive && !intersects(bounds(model), visible)) continue;
      const source = referenceSource(model, project);
      const linked = model.targetId && elementIndex(project).get(model.targetId)?.model;
      const asset = model.asset ?? source?.asset;
      const child = project.boards[model.boardId];
      const eventFormat = model.type === 'event' || source?.type === 'event' ? elementIndex(project).get(source?.id ?? model.id)?.board.timeline : undefined;
      if (!entry) {
        if (asset) callbacks.retain(asset);
        entry = { node: makeCard(model, project, callbacks), model, source, linked, asset, child, eventFormat, variables: project.variables };
        nodes.set(model.id, entry);
      } else {
        const refresh = entry.source !== source || entry.variables !== project.variables || entry.linked !== linked || entry.child !== child || entry.eventFormat !== eventFormat;
        if (model !== entry.model || refresh) {
          if (asset !== entry.asset || refresh && model.type === 'reference' && asset) {
            unload(entry);
            if (asset) callbacks.retain(asset);
          }
          reviseCard(entry.node, entry.model, model, project, callbacks, editing === model.id, refresh);
          Object.assign(entry, { model, source, linked, asset, child, eventFormat, variables: project.variables });
        }
      }
      const node = entry.node;
      const { locked } = access(model);
      node.classList.toggle('layer-locked', locked);
      node.classList.toggle('map-background', model.id === board.background);
      for (const control of node.querySelectorAll('input, .media-upload, .media-replace, .stack-toggle')) control.disabled = locked;
      node.classList.toggle('stack-drop-target', model.id === stackTarget);
      node.classList.toggle('selected', selected.has(model.id));
      node.classList.toggle('connect-from', connecting?.id === model.id);
      let handle = node.querySelector('.resize-handle');
      if (selected.size === 1 && selected.has(model.id) && editing !== model.id) {
        if (!handle) {
          handle = button('↘', null, 'resize-handle');
          handle.tabIndex = -1;
          handle.setAttribute('aria-label', 'Resize element');
          node.append(handle);
        }
        handle.style.setProperty('--handle-scale', String(1 / view.zoom));
      } else handle?.remove();
      order.push(model.id);
    }
    const mounted = new Set(order);
    for (const key of nodes.keys()) if (!mounted.has(key)) forget(key);
    if (order.length !== lastOrder.length || order.some((key, i) => key !== lastOrder[i])) {
      let next = stage.firstChild;
      for (const key of order) {
        const node = nodes.get(key).node;
        if (node !== next) stage.insertBefore(node, next);
        next = node.nextSibling;
      }
      lastOrder = order;
    }
    const screen = pos => ({ x: pos.x * view.zoom + view.x, y: pos.y * view.zoom + view.y });
    const connectionNodes = document.createDocumentFragment();
    if (board.kind === 'timeline') {
      const left = -view.x / view.zoom, right = (width - view.x) / view.zoom;
      for (const axis of timelineAxes(board.elements, timelineSettings(board), left, right, view.zoom)) {
        const y = screen({ x: 0, y: axis.y }).y;
        connectionNodes.append(svg('line', { x1: 0, y1: y, x2: width, y2: y, class: 'timeline-axis', 'data-timeline-axis': axis.lane }));
        for (const item of axis.items) {
          const x = screen({ x: item.axisX, y: 0 }).x;
          if (x < 0 || x > width) continue;
          const edge = Math.max(item.y, Math.min(item.y + item.h, axis.y));
          connectionNodes.append(svg('line', { x1: x, y1: y, x2: x, y2: screen({ x: 0, y: edge }).y,
            class: 'timeline-connector', 'data-event-connector': item.id }));
          connectionNodes.append(svg('circle', { cx: x, cy: y, r: 3, class: 'timeline-tick' }));
        }
        for (const tick of axis.ticks) {
          const x = screen({ x: tick.x, y: 0 }).x;
          connectionNodes.append(svg('line', { x1: x, y1: y - 4, x2: x, y2: y + 4, class: 'timeline-axis' }));
          const label = svg('text', { x, y: y - 9, class: 'timeline-axis-label' });
          label.textContent = tick.label;
          connectionNodes.append(label);
        }
      }
    }
    for (const link of board.connections) {
      const [start, end] = endpoints(modelById.get(link.from), modelById.get(link.to)).map(screen);
      if (!intersects({ left: Math.min(start.x, end.x), right: Math.max(start.x, end.x), top: Math.min(start.y, end.y), bottom: Math.max(start.y, end.y) },
        { left: -16, top: -16, right: width + 16, bottom: height + 16 })) continue;
      const group = linkSVG(link, start, end, { hit: true, variables: project.variables, labelScale: view.zoom });
      if (link.id === linkId) group.classList.add('selected-link');
      connectionNodes.append(group);
    }
    if (connecting?.point && modelById.has(connecting.id)) {
      const from = modelById.get(connecting.id);
      const start = screen({ x: from.x + from.w / 2, y: from.y + from.h / 2 });
      connectionNodes.append(svg('line', { x1: start.x, y1: start.y, x2: connecting.point.x, y2: connecting.point.y, stroke: '#B58A35', 'stroke-width': 2, 'stroke-dasharray': '5 5' }));
    }
    if (guides?.x !== undefined) {
      const x = screen({ x: guides.x, y: 0 }).x;
      connectionNodes.append(svg('line', { class: 'align-guide', x1: x, x2: x, y1: 0, y2: height }));
    }
    if (guides?.y !== undefined) {
      const y = screen({ x: 0, y: guides.y }).y;
      connectionNodes.append(svg('line', { class: 'align-guide', x1: 0, x2: width, y1: y, y2: y }));
    }
    if (marquee) connectionNodes.append(svg('rect', { class: 'selection-box', x: marquee.left, y: marquee.top, width: marquee.right - marquee.left, height: marquee.bottom - marquee.top }));
    links.replaceChildren(connectionNodes);
    $('zoom-reset').textContent = view.zoom < .01 ? `${(view.zoom * 100).toFixed(2)}%` : `${Math.round(view.zoom * 100)}%`;
    $('canvas-hint').hidden = Boolean(board.elements.length);
  }
  return {
    get: key => nodes.get(key)?.node,
    update(next, immediate = false) {
      state = next;
      if (immediate) { cancelAnimationFrame(frame); paint(); }
      else if (!frame) frame = requestAnimationFrame(paint);
    },
  };
}
