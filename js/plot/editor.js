import { setupUpdates } from './updates.js';
import { setupToolbarMenus } from '../toolbar-menus.js';
import { $, ask, button, dateLabel, element, report, setupCommon, task } from './common.js';
import { accepts, encodeProject } from './format.js';
import { download, fileName } from './download.js';
import { autosave } from './autosave.js';
import { copySelection, readClipboard } from './clipboard.js';
import { repository, snapshot } from './storage.js';
import { projectHistory, pruneViews } from './history.js';
import { mediaSources, importMedia, storeMedia } from './media.js';
import {
  LABEL, MEDIA_TYPES, SHAPES, WORKSPACES, boardLayers, layerId, connect, extractSelection, insertElement, insertSelection, layer, makeElement, parents, point,
  removeSelection, statistics, updateBoard, validateProject, viewDefault, WORLD,
} from './model.js';
import { boardBounds, fitView, worldAt, zoomAt } from './geometry.js';
import { createCanvasRenderer, resolvedHTML } from './render.js';
import { renderInspector, SHAPE_NAMES } from './inspector.js';
import { navigation } from './navigation.js';
import { bindContextDismissal, bindGestures, showContext } from './gestures.js';
import { bindToolbarDrag } from './toolbar-drag.js';
import { cleanHTML, pasteText } from './rich-text.js';
import { bindPlanningPanels } from './panels.js';
import { elementIndex, layerAccess, lockedSubtree, placeInStack, presentBoard, stackOpen } from './planning.js';
import { stackAncestors, stackFamily, topSelected } from './stack-tree.js';
import { TIMELINE_ORIGIN, timelineSettings } from './timeline.js';
import { bindTimelineControls } from './timeline-controls.js';
import { bindVariableSuggestions, resolveText } from './variables.js';

import { bindFloorEditor } from './floor-editor.js';
import { makePlan } from './floor-model.js';

const canvas = $('plot-canvas');
const EDITABLE = 'input, textarea, select, [contenteditable="true"]';
let beforeClose = async () => {};
window.plotForgeBeforeClose = () => beforeClose();
let backupOptions;
let onBackupOptions;
setupCommon(options => { backupOptions = options; onBackupOptions?.(); }, () => $('versions').click());

async function start() {
  const params = new URLSearchParams(location.search);
  const record = await repository.get(params.get('id') ?? '');
  if (!record || record.deletedAt) throw new Error('This project could not be opened. Return to the library to try again.');
  let project = validateProject(record.recovery.document);
  let draft, guides, marqueeRect, connecting, connectionId, editing, range, field;
  let mediaRequest, backupTimer, lastBackedUp, exporting = false;
  const selections = new Map(), history = projectHistory(), imports = new Set(), uploads = new Map();
  const nav = navigation(navigate);
  const saving = autosave(record, (message, error) => {
    $('save-state').textContent = message;
    $('save-error').hidden = !error;
    $('save-error-message').textContent = error?.message ?? '';
  });
  const media = mediaSources(repository);
  const renderer = createCanvasRenderer({ ...media, toggle: toggleItem, upload: chooseMedia, toggleStack, goTo });
  const active = () => project.view.active;
  const getBoard = () => project.boards[active()];
  const getView = () => project.view.byBoard[active()] ?? viewDefault();
  const getElement = key => getBoard().elements.find(model => model.id === key);
  const editable = (board, model) => {
    if (!model) return false;
    const access = layerAccess(board)(model);
    return !access.hidden && !access.locked;
  };
  const canEdit = key => editable(getBoard(), getElement(key));
  const canMove = key => canEdit(key) && !lockedSubtree(getBoard(), key);
  const interactionBoard = () => {
    const board = getBoard(), access = layerAccess(board), displayed = presentBoard(board);
    return { ...displayed, elements: displayed.elements.filter(model => !access(model).locked) };
  };
  const insertionLayer = board => boardLayers(board).find(layer => !layer.hidden && !layer.locked);
  const selectedIds = () => selections.get(active()) ?? new Set();
  const selectedConnection = () => getBoard().connections.find(link => link.id === connectionId &&
    canEdit(link.from) && canEdit(link.to) && presentBoard(getBoard()).connections.some(shown => shown.id === link.id));
  const pick = ids => selections.set(active(), ids);
  const selection = () => {
    const ids = selectedIds(), key = ids.values().next().value;
    return { count: ids.size, model: ids.size === 1 ? getElement(key) : undefined, link: selectedConnection(), editing: editing?.key === key };
  };
  const center = () => ({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 });
  const centerWorld = () => {
    const { x, y } = center();
    return worldAt(getView(), x, y);
  };

  function draftBoard() {
    const board = getBoard();
    if (draft?.id !== board.id) return board;
    return { ...board, elements: board.elements.map(model => {
      const position = draft.geometry.get(model.id);
      return position ? { ...model, ...position } : model;
    }) };
  }
  function paint(immediate = false) {
    floorEditor.paint(immediate);
    renderer.update({ project, board: presentBoard(draftBoard(), draft?.floating), view: getView(), selected: selectedIds(),
      linkId: connectionId, editing: editing?.key, guides, marquee: marqueeRect, connecting, stackTarget: draft?.target?.id }, immediate);
  }
  function updateUI(inspector = true) {
    const board = getBoard();
    const ids = new Set(interactionBoard().elements.filter(model => selectedIds().has(model.id)).map(model => model.id));
    pick(ids);
    if (!selectedConnection()) connectionId = undefined;
    if (document.activeElement !== $('document-title')) $('document-title').value = project.title;
    $('undo').disabled = !history.canUndo;
    $('redo').disabled = !history.canRedo;
    $('grid-toggle').textContent = (board.plan?.grid ?? project.settings.grid) ? 'Hide Grid' : 'Show Grid';
    $('guides-toggle').textContent = project.settings.guides ? 'Disable Alignment Guides' : 'Enable Alignment Guides';
    for (const key of ['connect', 'map-route']) $(key).setAttribute('aria-pressed', String(Boolean(connecting)));
    document.querySelector('[aria-label="Insert elements"]').hidden = Boolean(board.kind);
    $('map-tools').hidden = board.kind !== 'map' || Boolean(board.plan);
    $('map-image').textContent = board.background ? 'Replace Map Image' : 'Upload Map Image';
    $('timeline-tools').hidden = board.kind !== 'timeline';
    syncTimelineControls(board);
    canvas.classList.toggle('connecting', Boolean(connecting));
    $('selection-status').textContent = connecting ? connecting.id ? 'Choose a destination element' : 'Choose the first element'
      : connectionId ? 'Connection selected' : ids.size ? `${ids.size} selected` : 'Canvas ready';
    $('board-status').textContent = `${board.elements.length} ${board.elements.length === 1 ? 'element' : 'elements'} · ${board.connections.length} ${board.connections.length === 1 ? 'connection' : 'connections'}`;
    nav.update(project);
    if (inspector && !board.plan) renderInspector(api);
    floorEditor.sync(board, inspector);
    paint();
  }
  function assign(next, inspector = true) {
    project = next;
    saving.queue(project);
    updateUI(inspector);
  }
  function commit(next, { inspector = true, grouped } = {}) {
    if (next === project) return;
    if (!grouped?.recorded) {
      history.record(project);
      if (grouped) grouped.recorded = true;
    }
    assign(next, inspector);
  }
  function commitBoard(board, options) {
    if (board !== getBoard()) commit(updateBoard(project, board), options);
  }
  function patch(key, changes, refresh = false, grouped) {
    const board = getBoard(), model = getElement(key);
    if (!editable(board, model) || model.type === 'stack' && 'layout' in changes && !canMove(key) ||
      Object.entries(changes).every(([key, value]) => model[key] === value)) return;
    const next = { ...model, ...changes };
    for (const key of Object.keys(changes)) if (next[key] === undefined) delete next[key];
    commitBoard({ ...board, elements: board.elements.map(item => item.id === key ? next : item) }, { inspector: refresh, grouped });
  }
  function patchLink(changes, refresh = false) {
    const link = selectedConnection(), board = getBoard();
    if (!link) return;
    const next = { ...link, ...changes };
    if (board.connections.some(item => item.id !== link.id && item.from === next.from && item.to === next.to)) return report(new Error('This direction is already connected.'));
    commitBoard({ ...board, connections: board.connections.map(item => item.id === link.id ? next : item) }, { inspector: refresh });
  }
  function setSize(key, dimension, value) {
    if (!canMove(key)) return;
    const model = getElement(key);
    if (!model) return;
    const ratio = ['image', 'video'].includes(model.type) ? model.ratio ?? model.w / model.h : null;
    if (!ratio) return patch(key, { [dimension]: value });
    const height = dimension === 'h' ? value : value / ratio;
    const h = Math.min(WORLD, WORLD / ratio, Math.max(height, 32, 48 / ratio));
    patch(key, { w: h * ratio, h }, true);
  }

  function selectElement(key, additive = false, keepGroup = false) {
    if (!canEdit(key)) return;
    const ids = selectedIds();
    if (additive) {
      const next = new Set(ids);
      if (!next.delete(key)) next.add(key);
      pick(next);
    } else if (!keepGroup || !ids.has(key)) pick(new Set([key]));
    connectionId = undefined;
    updateUI();
  }
  function selectLink(key) {
    pick(new Set());
    connectionId = key;
    connecting = undefined;
    updateUI();
  }
  function clearSelection() {
    pick(new Set());
    connectionId = undefined;
    connecting = undefined;
    updateUI();
  }
  function selectAll() {
    endEditing();
    pick(new Set(interactionBoard().elements.map(model => model.id)));
    connectionId = undefined;
    updateUI();
  }
  function setView(view, persist = true) {
    project = { ...project, view: { ...project.view, byBoard: { ...project.view.byBoard, [active()]: view } } };
    if (persist) persistView();
    paint();
  }
  function persistView() { saving.queue(project); }
  function navigate(key) {
    if (!key || !project.boards[key] || key === active()) return;
    endEditing();
    connecting = connectionId = undefined;
    draft = guides = marqueeRect = undefined;
    assign(prepareTimeline({ ...project, view: { ...project.view, active: key } }));
    canvas.focus({ preventScroll: true });
  }
  function undo(forward) {
    endEditing();
    connecting = undefined;
    const next = forward ? history.redo(project) : history.undo(project);
    if (next !== project) {
      const before = getBoard(), after = next.boards[before.id];
      if (next.view.active === before.id && before.kind === 'timeline' && after?.kind === 'timeline') {
        const ratio = timelineSettings(after).scale / timelineSettings(before).scale;
        assign(ratio === 1 ? next : withTimelineView(next, scaledView(ratio)));
      } else assign(prepareTimeline(next));
    }
  }

  function beginField() { field = { recorded: false }; }
  function endField() { field = undefined; }
  function edit(key) {
    const model = getElement(key);
    if (!model || !canEdit(key) || !['note', 'text'].includes(model.type)) return;
    if (editing?.key === key) return;
    endEditing();
    selectElement(key);
    paint(true);
    const control = renderer.get(key)?.querySelector('.rich-content');
    if (!control) return;
    editing = { key, control, recorded: false };
    range = undefined;
    control.innerHTML = cleanHTML(model.html);
    control.contentEditable = 'true';
    control.setAttribute('role', 'textbox');
    control.setAttribute('aria-label', model.type === 'note' ? 'Note body' : 'Text content');
    control.setAttribute('aria-multiline', 'true');
    control.addEventListener('paste', pasteText);
    control.addEventListener('drop', prevent);
    control.oninput = syncText;
    control.focus({ preventScroll: true });
    const caret = document.createRange();
    caret.selectNodeContents(control);
    caret.collapse(false);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(caret);
    updateUI();
  }
  function syncText() {
    if (!editing) return;
    const html = cleanHTML(editing.control.innerHTML);
    if (html.length > 500_000) { report(new Error('This text box is full. Split its content into multiple boxes.')); return; }
    patch(editing.key, { html }, false, editing);
  }
  function prevent(event) { event.preventDefault(); }
  function endEditing() {
    if (!editing) return;
    const { key, control } = editing;
    syncText();
    editing = range = undefined;
    control.contentEditable = 'false';
    control.removeAttribute('role');
    control.removeAttribute('aria-label');
    control.removeAttribute('aria-multiline');
    control.removeEventListener('paste', pasteText);
    control.removeEventListener('drop', prevent);
    control.oninput = null;
    control.innerHTML = resolvedHTML(getElement(key)?.html ?? '', project.variables);
    updateUI();
  }
  function format(key, command, value) {
    if (editing?.key !== key) edit(key);
    if (editing?.key !== key) return;
    editing.control.focus({ preventScroll: true });
    if (range && editing.control.contains(range.commonAncestorContainer)) {
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand(command, false, value);
    syncText();
  }
  function activate(key) {
    const model = getElement(key);
    if (!model) return;
    if (WORKSPACES.includes(model.type)) navigate(model.boardId);
    else if (model.type === 'reference') goTo(model.targetId);
    else if (model.type === 'stack' && model.layout === 'collapsed') toggleStack(key);
    else if (model.type === 'text' || model.type === 'note') edit(key);
    else showInspector();
  }
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    if (editing && selection?.rangeCount && editing.control.contains(selection.anchorNode) && editing.control.contains(selection.focusNode)) range = selection.getRangeAt(0).cloneRange();
  });
  document.addEventListener('focusin', event => {
    if (editing && !editing.control.contains(event.target) && !event.target.closest('#plot-inspector')) endEditing();
  });

  function editItem(key, itemId, text) {
    const model = getElement(key);
    if (model) patch(key, { items: model.items.map(item => item.id === itemId ? { ...item, text } : item) }, false, field);
  }
  function toggleItem(key, itemId, done) {
    const model = getElement(key);
    if (model) patch(key, { items: model.items.map(item => item.id === itemId ? { ...item, done } : item) });
  }
  function moveItem(key, itemId, step) {
    const model = getElement(key);
    if (!model) return;
    const items = [...model.items], index = items.findIndex(item => item.id === itemId), to = index + step;
    if (index < 0 || to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]];
    patch(key, { items }, true);
  }
  function removeItem(key, itemId) {
    const model = getElement(key);
    if (model) patch(key, { items: model.items.filter(item => item.id !== itemId) }, true);
  }

  function place(model, board = active(), plan) {
    const layer = project.boards[board] && insertionLayer(project.boards[board]);
    if (!layer) { report(new Error('Show and unlock a layer before adding elements.')); return false; }
    if (layer.id !== 'default') model.layerId = layer.id;
    if (board === active()) {
      pick(new Set([model.id]));
      connectionId = connecting = undefined;
    }
    commit(insertElement(project, board, model, plan));
    return true;
  }
  function insert(type, pos = centerWorld(), options, plan) {
    endEditing();
    const model = makeElement(type, pos.x, pos.y, options);
    if (pos.fromCenter) {
      const used = getBoard().elements;
      const increment = 28 / getView().zoom;
      let offset = 0;
      while (used.some(other => Math.abs(other.x + other.w / 2 - model.x - offset) < increment / 2 &&
        Math.abs(other.y + other.h / 2 - model.y - offset) < increment / 2)) offset += increment;
      model.x = point(model.x + offset - model.w / 2);
      model.y = point(model.y + offset - model.h / 2);
    }
    if (!place(model, active(), plan)) return;
    if (type === 'event' && getBoard().kind === 'timeline') {
      const view = visibleEventView(project, model.id);
      if (view !== getView()) setView(view);
    }
    canvas.focus({ preventScroll: true });
    return model;
  }
  function trackImport(operation) {
    const work = operation();
    imports.add(work);
    return work.finally(() => imports.delete(work));
  }
  function addFiles(files, pos, board = active()) {
    return trackImport(async () => {
      const failures = [], models = [];
      for (const [index, file] of files.entries()) {
        try { models.push(await importMedia(file, pos.x + index * 30, pos.y + index * 30, repository)); }
        catch (error) { failures.push(error.message); }
      }
      if (models.length && project.boards[board]) {
        const layer = insertionLayer(project.boards[board]);
        if (!layer) throw new Error('Show and unlock a layer before adding elements.');
        let next = project;
        for (const model of models) next = insertElement(next, board, layer.id === 'default' ? model : { ...model, layerId: layer.id });
        if (board === active()) { pick(new Set(models.map(model => model.id))); connectionId = connecting = undefined; }
        commit(next);
      }
      if (failures.length) report(new Error(failures.join(' ')));
    });
  }
  function uploadMedia(file, boardId, model) {
    return trackImport(async () => {
      const token = Symbol();
      uploads.set(model.id, token);
      try {
        const media = await storeMedia(file, repository, model.type);
        if (uploads.get(model.id) !== token) return;
        const board = project.boards[boardId];
        const current = board?.elements.find(item => item.id === model.id);
        if (!editable(board, current) || current.asset !== model.asset) return;
        const { ratio, duration, ...card } = current;
        const replacement = { ...card, ...media };
        commit(updateBoard(project, { ...board, elements: board.elements.map(item => item.id === model.id ? replacement : item) }));
      } finally {
        if (uploads.get(model.id) === token) uploads.delete(model.id);
      }
    });
  }
  function duplicate() {
    endEditing();
    const fragment = extractSelection(project, active(), selectedIds());
    if (!fragment.elements.length) return;
    const copy = insertSelection(project, active(), fragment, 25 / getView().zoom, 25 / getView().zoom);
    pick(copy.ids);
    commit(copy.project);
  }
  async function paste(data, position = centerWorld()) {
    if (getBoard().plan) return;
    endEditing();
    if (data.files?.length) {
      if (getBoard().kind === 'map') {
        if (data.files.length !== 1) throw new Error('Paste one image to use as the map background.');
        return setMapImage(data.files[0], active());
      }
      return addFiles(data.files, position);
    }
    if (data.fragment?.elements.length) {
      if (!insertionLayer(getBoard())) throw new Error('Show and unlock a layer before pasting elements.');
      const source = data.fragment;
      const kind = getBoard().kind;
      if (source.elements.some(model => kind === 'map' ? model.type !== 'marker' :
        kind === 'timeline' ? model.type !== 'event' : ['marker', 'event'].includes(model.type))) {
        throw new Error('Paste locations onto maps, events onto timelines, and other cards onto canvases.');
      }
      const keys = new Set();
      for (const board of [source, ...Object.values(source.boards)]) for (const model of board.elements) if (model.asset) keys.add(model.asset);
      const board = active();
      for (const key of keys) if (!await repository.hasAsset(key)) throw new Error('Some copied media is unavailable in this storage profile. Use .plf to transfer media between devices.');
      if (active() !== board) return;
      const origin = boardBounds(source.elements);
      const copy = insertSelection(project, board, source, position.x - origin.left, position.y - origin.top);
      pick(copy.ids);
      connectionId = connecting = undefined;
      commit(copy.project);
    } else if (data.text?.trim() && !getBoard().kind) {
      const safe = element('div', null, data.text.slice(0, 90_000));
      insert('text', position, { html: safe.innerHTML });
    }
  }
  async function deleteSelection(cut = false) {
    endEditing();
    const board = active(), link = connectionId;
    const ids = cut ? stackFamily(getBoard().elements, selectedIds()) : new Set(selectedIds());
    if (!ids.size && !link) return;
    if (cut && [...ids].some(key => !canEdit(key))) throw new Error('Show and unlock the stack contents before cutting.');
    if (getBoard().elements.some(model => WORKSPACES.includes(model.type) && ids.has(model.id))) {
      if (!await ask('Delete nested canvas?', 'The selected workspaces and their contents will also be deleted. You can undo this in the editor.', undefined, 'Delete')) return;
      if (board !== active()) return;
    }
    pick(new Set());
    connectionId = connecting = undefined;
    const current = getBoard();
    const positions = new Map(presentBoard(current).elements.map(model => [model.id, model]));
    const prepared = current.elements.map(model => {
      if (!ids.has(model.stackId) || ids.has(model.id) || !positions.has(model.id)) return model;
      const { x, y } = positions.get(model.id);
      return { ...model, x, y };
    });
    commit(pruneViews(removeSelection(updateBoard(project, { ...current, elements: prepared }), board, ids, link)));
  }
  function moveLayer(forward) { commitBoard(layer(getBoard(), selectedIds(), forward)); }
  function toggleConnection() {
    endEditing();
    if (connecting) connecting = undefined;
    else connecting = { id: selectedIds().size === 1 ? selectedIds().values().next().value : undefined };
    updateUI();
    canvas.focus({ preventScroll: true });
  }
  function connectionClick(key) {
    if (!canEdit(key) || getBoard().kind === 'map' && getElement(key)?.type !== 'marker') return;
    if (!connecting.id) {
      connecting = { id: key };
      pick(new Set([key]));
    } else if (connecting.id !== key) {
      const board = connect(getBoard(), connecting.id, key);
      const link = board.connections.find(link => link.from === connecting.id && link.to === key);
      connecting = undefined;
      pick(new Set());
      connectionId = link.id;
      commitBoard(board);
    }
    updateUI();
  }
  const connectionHover = position => {
    if (connecting?.id) { connecting = { ...connecting, point: position }; paint(); }
  };
  const clearDraft = () => { draft = guides = marqueeRect = undefined; paint(); };
  const api = {
    selection, patch, patchLink, setSize, edit, endEditing, format, beginField, endField, editItem, moveItem, removeItem, getElement, navigate,
    duplicate, delete: () => deleteSelection(), layer: moveLayer, paint, activate, getBoard: interactionBoard, getView, selectedIds, selectElement, selectLink, clearSelection,
    setView, persistView, canEdit, canMove, editConnection,
    movableSelection(ids) { return topSelected(getBoard().elements, new Set([...ids].filter(canMove))); }, guidesEnabled: () => project.settings.guides, isConnecting: () => Boolean(connecting), connectionClick, connectionHover, clearDraft,
    previewBoard(original, elements, nextGuides, mode, position) {
      const geometry = new Map(), floating = new Set();
      const moving = mode === 'move', timeline = original.kind === 'timeline';
      for (const [index, model] of elements.entries()) {
        const before = original.elements[index];
        if (model === before) continue;
        const { x, y, w, h } = model;
        if (moving && timeline && model.type === 'event') {
          const offset = (before.timelineOffset ?? (before.axisY ? 24 : 0)) + y - before.y;
          const coords = { timelineOffset: point(offset) };
          if (!before.axisY && Math.abs(x - before.x) > 1) {
            const peers = original.elements.filter(item => item.type === 'event' && !item.axisY && item.id !== model.id)
              .sort((a, b) => a.x - b.x);
            const following = peers.findIndex(item => x < item.x);
            const previous = peers.findIndex(item => before.x < item.x);
            if (following !== previous) {
              const next = following < 0 ? undefined : peers[following];
              const prior = following < 0 ? peers.at(-1) : peers[following - 1];
              const lo = getElement(prior?.id)?.x, hi = getElement(next?.id)?.x;
              coords.x = point(lo === undefined ? hi - 1 : hi === undefined ? lo + 1 : (lo + hi) / 2);
            }
          }
          geometry.set(model.id, coords);
        } else {
          geometry.set(model.id, moving ? { x, y } : { x, y, w, h });
          if (moving && model.stackId) floating.add(model.id);
        }
      }
      const excluded = moving && !timeline ? stackFamily(getBoard().elements, geometry.keys()) : new Set();
      const target = excluded.size && [...original.elements].reverse().find(model => model.type === 'stack' && !excluded.has(model.id) && canMove(model.id) &&
        position.x >= model.x && position.x <= model.x + model.w && position.y >= model.y && position.y <= model.y + model.h);
      draft = { id: original.id, geometry, floating, target, position, mode, displayed: original.elements };
      guides = nextGuides;
      paint();
    },
    commitDraft() {
      const base = getBoard(), preview = draft;
      if (preview?.id !== base.id) return;
      let next = draftBoard();
      if (preview.mode === 'move' && base.kind !== 'timeline') {
        next = { ...next, elements: placeInStack(next.elements, new Set(preview.geometry.keys()), preview.target, preview.position, preview.displayed) };
      } else if (preview.mode !== 'move') {
        const originals = new Map(base.elements.map(model => [model.id, model]));
        next = { ...next, elements: next.elements.map(model => {
          const old = originals.get(model.id);
          return model !== old && (model.stackId || model.type === 'event') ? { ...model, x: old.x, y: old.y } : model;
        }) };
      }
      clearDraft();
      commitBoard(next);
      paint(true);
    },
    marquee(ids, rect) {
      marqueeRect = rect;
      const selected = selectedIds();
      if (!connectionId && !connecting && ids.size === selected.size && [...ids].every(id => selected.has(id))) {
        paint();
        return;
      }
      connectionId = connecting = undefined;
      pick(ids);
      updateUI();
    },
  };

  function editConnection(key) {
    selectLink(key);
    if (!selectedConnection()) return;
    showInspector();
    $('inspector-body').querySelector('[aria-label="Connection label"]')?.focus();
  }
  function toggleStack(key) {
    const model = getElement(key);
    if (model?.type === 'stack') patch(key, { expanded: !model.expanded }, true);
  }
  function goTo(key) {
    const target = elementIndex(project).get(key);
    if (!target) return;
    navigate(target.board.id);
    const closed = new Set(stackAncestors(getBoard().elements, key)
      .filter(container => !stackOpen(container) && canEdit(container.id)).map(container => container.id));
    if (closed.size) {
      const board = getBoard();
      commitBoard({ ...board, elements: board.elements.map(model => closed.has(model.id) ? { ...model, expanded: true } : model) });
    }
    const shown = presentBoard(getBoard()).elements.find(model => model.id === key);
    if (!shown) return report(new Error('Show the original layer or expand its stack to see this element.'));
    const view = getView(), focus = center();
    setView({ ...view, x: focus.x - (shown.x + shown.w / 2) * view.zoom, y: focus.y - (shown.y + shown.h / 2) * view.zoom });
    selectElement(key);
  }
  const chooseTarget = bindPlanningPanels({ project: () => project, board: getBoard, selected: selectedIds, canEdit, commit, commitBoard });
  bindVariableSuggestions(() => project.variables);
  $('add-reference').onclick = () => chooseTarget('Reference an Element', key => {
    if (elementIndex(project).has(key)) insert('reference', { ...centerWorld(), fromCenter: true }, { targetId: key });
  }, { crossCanvas: true });
  Object.assign(api, {
    goTo, toggleStack, board: getBoard, updateEventSchedule,
    layers: () => boardLayers(getBoard()),
    moveToLayer(key, target) {
      const layer = boardLayers(getBoard()).find(item => item.id === target);
      if (layer && !layer.hidden && !layer.locked) patch(key, { layerId: target }, true);
    },
    linkElement(key) {
      chooseTarget('Link an Element', targetId => patch(key, { targetId }, true), { exclude: key });
    },
  });
  function withTimelineView(source, view) {
    const { active, byBoard } = source.view;
    return { ...source, view: { active, byBoard: { ...byBoard, [active]: view } } };
  }
  function scaledView(ratio) {
    const view = getView(), focus = center().x;
    const origin = view.x + TIMELINE_ORIGIN * view.zoom;
    return { ...view, x: Math.max(-WORLD * 10, Math.min(WORLD * 10, focus - (focus - origin) * ratio - TIMELINE_ORIGIN * view.zoom)) };
  }
  function visibleEventView(source, key) {
    const board = source.boards[source.view.active];
    const view = source.view.byBoard[board.id] ?? viewDefault();
    const projected = presentBoard(board).elements;
    const model = key ? projected.find(item => item.id === key) : projected.find(item => item.type === 'event' && item.axisY);
    if (!model) return view;
    const x = view.x + (model.x + model.w / 2) * view.zoom;
    const y = view.y + (model.y + model.h / 2) * view.zoom;
    const visibleX = x >= 0 && x <= canvas.clientWidth, visibleY = y >= 0 && y <= canvas.clientHeight;
    if (visibleX && visibleY) return view;
    const focus = center();
    return { ...view, x: visibleX ? view.x : view.x + focus.x - x, y: visibleY ? view.y : view.y + focus.y - y };
  }
  function prepareTimeline(source) {
    const board = source.boards[source.view.active];
    if (board.kind !== 'timeline' || board.timeline) return source;
    return withTimelineView(updateBoard(source, { ...board, timeline: timelineSettings(board) }), visibleEventView(source));
  }
  function updateEventSchedule(key, changes, refresh = false) {
    const board = getBoard(), model = getElement(key);
    if (!canEdit(key) || Object.entries(changes).every(([field, value]) => model[field] === value)) return;
    const next = updateBoard(project, { ...board, elements: board.elements.map(item => item.id === key ? { ...model, ...changes } : item) });
    commit(withTimelineView(next, visibleEventView(next, key)), { inspector: refresh });
  }
  const syncTimelineControls = bindTimelineControls(getBoard, (timeline, grouped) => {
    const board = getBoard();
    const ratio = timeline.scale / timelineSettings(board).scale;
    const next = updateBoard(project, { ...board, timeline });
    commit(ratio === 1 ? next : withTimelineView(next, scaledView(ratio)), { grouped });
  });
  const floorEditor = bindFloorEditor({
    view: getView, setView, variables: () => project.variables,
    change(plan, undoable = true) {
      const board = { ...getBoard(), plan };
      if (undoable) commitBoard(board);
      else assign(updateBoard(project, board));
    },
  });
  const gesture = bindGestures(api);
  bindContextDismissal();
  setupToolbarMenus();
  new ResizeObserver(() => paint()).observe(canvas);
  function zoom(factor, reset = false) {
    const pos = center(), view = getView();
    setView(zoomAt(view, pos.x, pos.y, reset ? 1 : view.zoom * factor));
  }
  $('zoom-in').onclick = () => zoom(1.25);
  $('zoom-out').onclick = () => zoom(.8);
  $('zoom-reset').onclick = () => zoom(1, true);
  $('fit').onclick = () => getBoard().plan ? floorEditor.fit() : setView(fitView(presentBoard(getBoard()).elements, canvas.clientWidth, canvas.clientHeight));
  $('connect').onclick = $('map-route').onclick = toggleConnection;
  $('map-marker').onclick = () => insert('marker', { ...centerWorld(), fromCenter: true });
  $('timeline-event').onclick = () => insert('event', { ...centerWorld(), fromCenter: true });
  $('select-all').onclick = () => getBoard().plan ? floorEditor.selectAll() : selectAll();
  $('undo').onclick = () => undo(false);
  $('redo').onclick = () => undo(true);
  $('grid-toggle').onclick = () => getBoard().plan ? floorEditor.toggleGrid() : commit({ ...project, settings: { ...project.settings, grid: !project.settings.grid } });
  $('guides-toggle').onclick = () => commit({ ...project, settings: { ...project.settings, guides: !project.settings.guides } });
  $('help').onclick = () => $('help-dialog').showModal();
  function panel(control, target) {
    const set = visible => { target.hidden = !visible; control.setAttribute('aria-pressed', String(visible)); };
    set(!matchMedia('(max-width: 800px)').matches);
    control.onclick = () => set(target.hidden);
    return () => set(true);
  }
  panel($('outline-toggle'), $('plot-outline'));
  const showInspector = panel($('inspector-toggle'), $('plot-inspector'));

  const title = $('document-title');
  title.onfocus = beginField;
  title.onblur = () => { endField(); title.value = project.title; };
  title.oninput = () => {
    const name = title.value.trim() || 'Untitled Project';
    if (name !== project.title) commit({ ...project, title: name }, { inspector: false, grouped: field });
  };
  title.onkeydown = event => { if (event.key === 'Enter') title.blur(); };

  const picker = $('media-file');
  function chooseMedia(model) {
    if (!canEdit(model.id)) return;
    mediaRequest = { model, board: active() };
    picker.accept = accepts[model.type];
    picker.click();
  }
  $('map-image').onclick = () => {
    mediaRequest = { map: true, board: active() };
    picker.accept = accepts.image;
    picker.click();
  };
  function setMapImage(file, boardId) {
    return trackImport(async () => {
      const original = project.boards[boardId];
      const originalImage = original?.elements.find(model => model.id === original.background);
      const media = await storeMedia(file, repository, 'image');
      const board = project.boards[boardId];
      if (board?.kind !== 'map' || board.background !== original?.background) return;
      const layer = originalImage ? boardLayers(board).find(layer => layer.id === layerId(originalImage)) : insertionLayer(board);
      if (!layer || layer.locked || layer.hidden) throw new Error('Show and unlock the map image layer before editing it.');
      const existing = board.elements.find(model => model.id === board.background);
      if (existing && existing.asset !== originalImage?.asset) return;
      const image = { ...(existing ?? makeElement('image', 35, 35, {
        w: Math.max(24, Math.min(880, 620 * (media.ratio ?? 1.5))),
        h: Math.max(24, Math.min(620, 880 / (media.ratio ?? 1.5))), layerId: layer.id,
      })), ratio: undefined, ...media };
      const elements = existing ? board.elements.map(model => model.id === existing.id ? image : model) : [image, ...board.elements];
      commit(updateBoard(project, { ...board, background: image.id, elements }));
    });
  }
  picker.addEventListener('change', () => {
    const file = picker.files[0], request = mediaRequest;
    picker.value = '';
    mediaRequest = undefined;
    if (file && request) {
      if (request.map) task(setMapImage)(file, request.board);
      else task(uploadMedia)(file, request.board, request.model);
    }
  });
  picker.addEventListener('cancel', () => { mediaRequest = undefined; });

  const mapDialog = $('map-type-dialog');
  function insertAt(type, position, editText = false) {
    if (type === 'map') {
      const board = active();
      mapDialog.returnValue = '';
      mapDialog.addEventListener('close', () => {
        const choice = mapDialog.returnValue;
        if (active() !== board) return;
        if (choice === 'plan') insert(type, position, { title: 'Untitled Floor Plan' }, makePlan());
        else if (choice === 'world') insert(type, position);
      }, { once: true });
      mapDialog.showModal();
      return;
    }
    const model = insert(type, position);
    if (model && editText && type === 'text') edit(model.id);
  }
  const toolbar = document.querySelector('.format-toolbar');
  bindToolbarDrag(toolbar, canvas, (type, event) => {
    const { x, y } = gesture.position(event);
    insertAt(type, worldAt(getView(), x, y));
  });
  toolbar.addEventListener('click', event => {
    const control = event.target.closest('[data-insert]');
    // Keyboard and assistive activation deliberately insert at the viewport center.
    if (!control || event.detail !== 0) return;
    const type = control.dataset.insert;
    const position = { ...centerWorld(), fromCenter: true };
    if (type === 'shape') {
      const rect = control.getBoundingClientRect();
      showContext({ clientX: rect.left, clientY: rect.bottom + 3 }, SHAPES.map(shape => [SHAPE_NAMES[shape], () => insert('shape', position, { shape })]));
    } else insertAt(type, position, true);
  });
  function mediaTarget(event) {
    const node = event.target.closest('[data-element]');
    return node && MEDIA_TYPES.includes(node.dataset.type) ? node : null;
  }
  let fileTarget;
  function highlightFileTarget(target) {
    fileTarget?.classList.remove('media-drop-target');
    fileTarget = target;
    fileTarget?.classList.add('media-drop-target');
  }
  function clearFileDrop() {
    canvas.classList.remove('file-over');
    highlightFileTarget(null);
  }
  canvas.addEventListener('dragover', event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvas.classList.add('file-over');
    highlightFileTarget(mediaTarget(event));
  });
  canvas.addEventListener('dragleave', event => {
    if (!canvas.contains(event.relatedTarget)) clearFileDrop();
  });
  canvas.addEventListener('drop', event => {
    event.preventDefault();
    clearFileDrop();
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    if (getBoard().plan) return;
    if (getBoard().kind === 'map') {
      if (files.length === 1) task(setMapImage)(files[0], active());
      else report(new Error('Drop one image to use as the map background.'));
      return;
    }
    const target = mediaTarget(event);
    if (target) {
      const model = getElement(target.dataset.element);
      if (files.length !== 1) return report(new Error(`Choose one file for this ${target.dataset.type} card.`));
      if (model) task(uploadMedia)(files[0], active(), model);
      return;
    }
    const { x, y } = gesture.position(event);
    task(addFiles)(files, worldAt(getView(), x, y));
  });
  for (const type of ['dragover', 'drop']) document.addEventListener(type, event => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  function canUseShortcuts(event) {
    return !event.target.closest?.(EDITABLE) && !document.querySelector('dialog[open]');
  }
  function copy(event, cut = false) {
    if (!canUseShortcuts(event) || !selectedIds().size) return;
    event.preventDefault();
    copySelection(project, selectedIds(), event.clipboardData);
    if (cut) task(deleteSelection)(true);
  }
  document.addEventListener('copy', copy);
  document.addEventListener('cut', event => copy(event, true));
  document.addEventListener('paste', event => {
    if (!canUseShortcuts(event)) return;
    event.preventDefault();
    task(paste)(readClipboard(event.clipboardData));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && editing && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      endEditing();
      canvas.focus({ preventScroll: true });
      return;
    }
    if (!canUseShortcuts(event) || event.defaultPrevented) return;
    const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
    let action;
    if (command && canvas.contains(event.target) && !event.target.closest('audio, video')) {
      if (key === '+' || key === '=' || event.code === 'NumpadAdd') action = () => zoom(1.25);
      else if (key === '-' || event.code === 'NumpadSubtract') action = () => zoom(.8);
      else if (key === '0' || event.code === 'Numpad0') action = () => zoom(1, true);
    }
    if (action) {
      event.preventDefault();
      action();
      return;
    }
    if (command && key === 'z') action = () => undo(event.shiftKey);
    else if (command && key === 'y') action = () => undo(true);
    else if (command && key === 'a') action = selectAll;
    else if (command && key === 'd') action = duplicate;
    else if (command && key === 's') action = task(() => saving.flush());
    else if (key === 'delete' || key === 'backspace') action = task(deleteSelection);
    else if (key === 'escape') action = () => { gesture.cancelMarquee(); clearSelection(); };
    else if (event.code === 'Space' && !event.target.closest?.('button, summary, a')) action = () => gesture.holdSpace(true);
    if (action) { event.preventDefault(); action(); }
  });

  canvas.addEventListener('contextmenu', event => {
    if (event.target.closest(EDITABLE)) return;
    event.preventDefault();
    endEditing();
    const { x, y } = gesture.position(event), position = worldAt(getView(), x, y);
    const key = event.target.closest('[data-element]')?.dataset.element;
    const link = event.target.closest('[data-connection]')?.dataset.connection;
    const doPaste = task(() => paste(readClipboard(), position));
    if (key) {
      if (!canEdit(key)) return;
      selectElement(key, false, true);
      const model = getElement(key);
      const editAction = model.type === 'canvas' || model.title !== undefined && model.type !== 'note' ? () => {
        showInspector();
        $('inspector-body').querySelector('input[type=text]')?.focus();
      } : () => activate(key);
      const items = [
        ...(WORKSPACES.includes(model.type) ? [[`Open ${LABEL[model.type]}`, () => navigate(model.boardId)]] : []),
        ...(MEDIA_TYPES.includes(model.type) ? [[`${model.asset ? 'Replace' : 'Upload'} ${LABEL[model.type]}`, () => chooseMedia(model)]] : [['Edit', editAction]]), ['Duplicate', duplicate], ['Copy', () => copySelection(project, selectedIds())],
        ['Cut', task(async () => { copySelection(project, selectedIds()); await deleteSelection(true); })],
        ['Paste', doPaste], ['Delete', task(deleteSelection)], ['Bring Forward', () => moveLayer(true)],
        ['Send Backward', () => moveLayer(false)], ['Color and Style', showInspector],
      ];
      showContext(event, items);
    } else if (link) {
      selectLink(link);
      showContext(event, [['Edit Connection', () => editConnection(link)], ['Delete', task(deleteSelection)]]);
    } else showContext(event, [
      ...(getBoard().kind === 'map' ? ['marker'] : getBoard().kind === 'timeline' ? ['event'] : ['text', 'note', 'list', 'canvas', 'shape', 'image', 'audio', 'video', 'stack', 'map', 'timeline']).map(type => [`Add ${LABEL[type]}`, () => insertAt(type, position, true)]),
      ['Paste', doPaste],
    ]);
  });

  const flush = async () => {
    endEditing();
    await Promise.all([...imports]);
    await saving.flush();
  };
  beforeClose = flush;
  void setupUpdates().catch(console.error);
  $('save').onclick = $('retry-save').onclick = task(flush);
  const openLibrary = task(async () => { await flush(); location.href = './'; });
  for (const id of ['library-back', 'library']) $(id).onclick = event => { event.preventDefault(); openLibrary(); };
  $('file-library').onclick = openLibrary;
  window.addEventListener('beforeunload', event => {
    if (!saving.dirty && !imports.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) saving.flush().catch(() => {}); });
  window.addEventListener('pagehide', () => saving.flush().catch(() => {}));
  $('statistics').onclick = () => {
    const stats = $('stats-list');
    stats.replaceChildren(...Object.entries(statistics(project)).flatMap(([label, total]) => [element('dt', null, label), element('dd', null, String(total))]));
    $('stats-dialog').showModal();
  };
  async function versions() {
    const rows = await repository.listVersions(project.id);
    $('version-list').replaceChildren(...(rows.length ? rows.sort((a, b) => b.at - a.at).map(version => button(
      `${version.reason} · ${dateLabel(version.at)}`, task(async () => {
        $('versions-dialog').close();
        if (!await ask('Restore this version?', 'Your current project will be backed up first. The restored project will autosave locally.', undefined, 'Restore')) return;
        await flush();
        await snapshot(project, 'Before Restore');
        selections.clear();
        connecting = connectionId = undefined;
        commit(validateProject(version.project));
      }),
    )) : [element('p', null, 'No snapshots yet.')]));
  }
  $('versions').onclick = task(async () => { await versions(); $('versions-dialog').showModal(); });
  $('version-create').onclick = task(async () => { await flush(); await snapshot(project, 'Manual Backup'); await versions(); });
  onBackupOptions = () => {
    clearInterval(backupTimer);
    if (!backupOptions?.enabled) return;
    backupTimer = setInterval(task(async () => {
      if (project.boards === lastBackedUp?.boards && project.title === lastBackedUp?.title && project.settings === lastBackedUp?.settings && project.variables === lastBackedUp?.variables) return;
      const saved = project;
      await snapshot(saved, 'Automatic Backup');
      lastBackedUp = saved;
    }), backupOptions.interval * 60_000);
  };
  onBackupOptions();

  async function exportProject(kind) {
    if (exporting) return;
    exporting = true;
    const detail = document.querySelector('.export-menu:not(.browser-download)');
    detail.open = false;
    try {
      endEditing();
      await Promise.all([...imports]);
      const saved = project;
      const board = saved.boards[saved.view.active];
      $('save-state').textContent = 'Preparing export…';
      let blob;
      if (kind === 'plf') blob = await encodeProject(saved, repository.getAsset);
      else {
        const { exportCanvas } = await import('./export-canvas.js');
        blob = await exportCanvas(saved, board, repository, kind);
      }
      const title = resolveText(board.id === saved.root ? saved.title : parents(saved).get(board.id).element.title, saved.variables);
      const floorName = board.plan?.floors.find(floor => floor.id === board.plan.active)?.name;
      await download(blob, fileName(kind === 'plf' ? saved.title : floorName ? `${title} - ${floorName}` : title, kind));
    } finally {
      exporting = false;
      $('save-state').textContent = saving.dirty ? 'Saving locally…' : 'Saved locally';
    }
  }
  for (const control of document.querySelectorAll('[data-export]')) control.onclick = task(() => exportProject(control.dataset.export));
  document.addEventListener('click', event => {
    const menu = document.querySelector('.export-menu:not(.browser-download)');
    if (!menu.contains(event.target)) menu.open = false;
  });

  $('save-state').textContent = 'Saved locally';
  document.body.classList.remove('loading');
  const prepared = prepareTimeline(project);
  if (prepared === project) updateUI();
  else assign(prepared);
  paint(true);
}

start().catch(error => {
  $('save-state').textContent = 'Project unavailable';
  $('save-error').hidden = false;
  $('save-error-message').textContent = error.message;
  $('retry-save').hidden = true;
});
