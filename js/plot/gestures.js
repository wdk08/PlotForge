import { $, button } from './common.js';
import { clamp, point, WORLD } from './model.js';
import { bounds, intersects, resizeElement, snapMove, worldAt, zoomAt } from './geometry.js';

const INTERACTIVE = 'input, button, select, textarea, audio, video, [contenteditable=true]';
const coords = (first, last) => ({
  left: Math.min(first.x, last.x), top: Math.min(first.y, last.y),
  right: Math.max(first.x, last.x), bottom: Math.max(first.y, last.y),
});
const distance = (first, last) => Math.hypot(last.x - first.x, last.y - first.y);
const middle = (first, last) => ({ x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 });
const pan = value => clamp(value, -WORLD * 10, WORLD * 10);
export function bindGestures(editor) {
  const canvas = $('plot-canvas');
  const pointers = new Map();
  let gesture, space = false, lastTap, safariPinch;
  const position = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function finish(event, cancelled) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    const current = gesture;
    if (!current || current.mode === 'pinch' && pointers.size > 1) return;
    if (current.mode !== 'pinch' && current.pointer !== event.pointerId) return;
    const touchTap = event.pointerType === 'touch' && !cancelled && !current.moved && current.mode === 'move';
    gesture = null;
    canvas.classList.remove('panning');
    if (current.mode === 'pan' || current.mode === 'pinch') editor.persistView();
    else if (!cancelled && (current.mode === 'move' || current.mode === 'resize') && current.moved) editor.commitDraft();
    else if (current.mode === 'marquee') {
      if (cancelled && current.moved) editor.marquee(current.previous);
      else if (!cancelled && !current.moved) editor.clearSelection();
    }
    editor.clearDraft();
    if (touchTap) {
      const now = performance.now();
      if (lastTap?.id === current.key && now - lastTap.at < 350) {
        editor.activate(current.key);
        lastTap = null;
      } else lastTap = { id: current.key, at: now };
    }
  }
  canvas.addEventListener('pointerdown', event => {
    if (![0, 1].includes(event.button) || event.target.closest('#zoom-controls')) return;
    const pos = position(event);
    const target = event.target.closest('[data-element]');
    const link = event.target.closest('[data-connection]');
    const resize = event.target.closest('.resize-handle');
    const panTool = event.button === 1 || space;
    if (!panTool && !resize && event.target.closest(INTERACTIVE)) return;
    if (event.pointerType === 'touch') {
      pointers.set(event.pointerId, pos);
      if (pointers.size >= 2) {
        const [first, last] = pointers.values();
        editor.clearDraft();
        gesture = { mode: 'pinch', view: editor.getView(), center: middle(first, last), distance: distance(first, last) };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (gesture) return;
    editor.endEditing();
    canvas.focus({ preventScroll: true });
    if (!panTool && !resize && editor.isConnecting() && target) {
      editor.connectionClick(target.dataset.element);
      pointers.delete(event.pointerId);
      return;
    }
    if (!panTool && !resize && link) {
      editor.selectLink(link.dataset.connection);
      pointers.delete(event.pointerId);
      return;
    }
    const key = target?.dataset.element;
    if (!panTool && key && !resize) {
      editor.selectElement(key, event.shiftKey || event.metaKey || event.ctrlKey, true);
      if (!editor.selectedIds().has(key)) {
        pointers.delete(event.pointerId);
        return;
      }
    }
    const mode = panTool ? 'pan' : resize ? 'resize' : key ? 'move' : event.pointerType === 'touch' ? 'pan' : 'marquee';
    const view = editor.getView(), board = editor.getBoard();
    const selected = editor.selectedIds();
    gesture = { mode, key, view, board, selected, start: pos, pointer: event.pointerId, moved: false };
    if (mode === 'move') {
      gesture.moving = board.elements.filter(model => selected.has(model.id));
      gesture.others = board.elements.filter(model => !selected.has(model.id));
    } else if (mode === 'resize') gesture.model = editor.getElement(key);
    else if (mode === 'marquee') {
      gesture.previous = selected;
      gesture.selected = event.shiftKey ? selected : new Set();
    } else if (!panTool) editor.clearSelection();
    pointers.set(event.pointerId, pos);
    // Keep mouse clicks targeted at the card so native double-click works.
    if (event.pointerType === 'touch' || panTool || !key || resize) canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  window.addEventListener('pointermove', event => {
    const pos = position(event);
    if (!gesture) { if (canvas.contains(event.target)) editor.connectionHover(pos); return; }
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pos);
    const current = gesture;
    if (current.mode === 'pinch') {
      if (pointers.size < 2 || current.distance < 1) return;
      const [first, last] = pointers.values();
      const target = middle(first, last);
      const view = zoomAt(current.view, current.center.x, current.center.y, current.view.zoom * distance(first, last) / current.distance);
      editor.setView({ ...view, x: pan(view.x + target.x - current.center.x), y: pan(view.y + target.y - current.center.y) }, false);
      return;
    }
    if (current.pointer !== event.pointerId) return;
    const dx = pos.x - current.start.x, dy = pos.y - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    current.moved = true;
    const { mode, view, board } = current;
    if (mode === 'pan') {
      canvas.classList.add('panning');
      editor.setView({ ...view, x: pan(view.x + dx), y: pan(view.y + dy) }, false);
    } else if (mode === 'move') {
      const snap = editor.guidesEnabled() && !event.altKey ? snapMove(current.moving, current.others, dx / view.zoom, dy / view.zoom, view.zoom)
        : { dx: dx / view.zoom, dy: dy / view.zoom };
      const elements = board.elements.map(model => current.selected.has(model.id) ? { ...model, x: point(model.x + snap.dx), y: point(model.y + snap.dy) } : model);
      editor.previewBoard(board, elements, snap);
    } else if (mode === 'resize') {
      const next = resizeElement(current.model, dx / view.zoom, dy / view.zoom, event.altKey);
      editor.previewBoard(board, board.elements.map(model => model.id === next.id ? next : model));
    } else {
      const viewport = editor.getView();
      const area = coords(worldAt(viewport, current.start.x, current.start.y), worldAt(viewport, pos.x, pos.y));
      const next = new Set(current.selected);
      for (const model of board.elements) if (intersects(bounds(model), area)) next.add(model.id);
      editor.marquee(next, coords(current.start, pos));
    }
  });
  window.addEventListener('pointerup', event => finish(event, false));
  window.addEventListener('pointercancel', event => finish(event, true));
  canvas.addEventListener('dblclick', event => {
    const key = event.target.closest('[data-element]')?.dataset.element;
    if (key && !event.target.closest(INTERACTIVE)) editor.activate(key);
  });
  canvas.addEventListener('wheel', event => {
    if (event.target.closest('audio, video')) return;
    const dx = event.deltaX * (event.deltaMode === 1 ? 15 : event.deltaMode === 2 ? canvas.clientWidth : 1);
    const dy = event.deltaY * (event.deltaMode === 1 ? 15 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    const scrollable = event.target.closest('.plot-list, .rich-content');
    if (!event.ctrlKey && scrollable && (
      (dy < 0 && scrollable.scrollTop > 0) ||
      (dy > 0 && scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight - 1) ||
      (dx < 0 && scrollable.scrollLeft > 0) ||
      (dx > 0 && scrollable.scrollLeft + scrollable.clientWidth < scrollable.scrollWidth - 1)
    )) return;
    event.preventDefault();
    const view = editor.getView();
    // Chromium delivers trackpad pinch as Ctrl+wheel.
    if (event.ctrlKey) {
      const { x, y } = position(event);
      editor.setView(zoomAt(view, x, y, view.zoom * Math.exp(-clamp(dy, -300, 300) * .006)));
    } else {
      editor.setView({ ...view, x: pan(view.x - dx), y: pan(view.y - dy) });
    }
  }, { passive: false });
  canvas.addEventListener('gesturestart', event => {
    event.preventDefault();
    if (!pointers.size) safariPinch = { view: editor.getView(), ...position(event) };
  }, { passive: false });
  canvas.addEventListener('gesturechange', event => {
    event.preventDefault();
    if (safariPinch) editor.setView(zoomAt(safariPinch.view, safariPinch.x, safariPinch.y, safariPinch.view.zoom * event.scale), false);
  }, { passive: false });
  canvas.addEventListener('gestureend', event => {
    event.preventDefault();
    if (safariPinch) editor.persistView();
    safariPinch = null;
  }, { passive: false });

  function holdSpace(value) {
    space = value;
    canvas.classList.toggle('space-held', value);
  }
  window.addEventListener('keyup', event => { if (event.code === 'Space') holdSpace(false); });
  window.addEventListener('blur', () => {
    holdSpace(false);
    if (gesture?.mode === 'pan' || gesture?.mode === 'pinch') editor.persistView();
    gesture = null;
    pointers.clear();
    canvas.classList.remove('panning');
    editor.clearDraft();
  });
  function cancelMarquee() {
    if (gesture?.mode !== 'marquee') return;
    const pointer = gesture.pointer;
    gesture = null;
    pointers.delete(pointer);
    if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
    editor.clearDraft();
  }
  return { position, holdSpace, cancelMarquee };
}

export function showContext(event, items) {
  const menu = $('context-menu');
  menu.replaceChildren(...items.map(([name, action, disabled]) => {
    const item = button(name, () => {
      menu.hidden = true;
      $('plot-canvas').focus({ preventScroll: true });
      action();
    });
    item.setAttribute('role', 'menuitem');
    item.disabled = Boolean(disabled);
    return item;
  }));
  menu.hidden = false;
  menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 6))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}

export function bindContextDismissal() {
  const menu = $('context-menu');
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) menu.hidden = true; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      menu.hidden = true;
      $('plot-canvas').focus();
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  });
}
