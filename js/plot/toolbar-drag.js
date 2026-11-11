import { element } from './common.js';

export function bindToolbarDrag(toolbar, canvas, drop) {
  let drag;

  function canDrop(event) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    return canvas.contains(target) && !target.closest('#zoom-controls');
  }

  function finish() {
    if (!drag) return;
    const { control, pointer, preview } = drag;
    drag = undefined;
    preview?.remove();
    canvas.classList.remove('toolbar-drop-ready', 'toolbar-drop-over');
    if (control.hasPointerCapture(pointer)) control.releasePointerCapture(pointer);
  }

  toolbar.addEventListener('pointerdown', event => {
    const control = event.target.closest('[data-insert]');
    if (!control || control.disabled || event.button !== 0 || !event.isPrimary || drag) return;
    drag = { control, pointer: event.pointerId, x: event.clientX, y: event.clientY };
    control.setPointerCapture(event.pointerId);
  });

  toolbar.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    if (!drag.preview) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      drag.preview = element('div', 'toolbar-drag-preview');
      drag.preview.setAttribute('aria-hidden', 'true');
      drag.preview.append(...[...drag.control.childNodes].map(node => node.cloneNode(true)));
      document.body.append(drag.preview);
      canvas.classList.add('toolbar-drop-ready');
    }
    drag.preview.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`;
    const valid = canDrop(event);
    drag.preview.classList.toggle('can-drop', valid);
    canvas.classList.toggle('toolbar-drop-over', valid);
  });

  toolbar.addEventListener('pointerup', event => {
    if (drag?.pointer !== event.pointerId) return;
    const type = drag.preview && canDrop(event) ? drag.control.dataset.insert : null;
    finish();
    if (type) drop(type, event);
  });

  for (const type of ['pointercancel', 'lostpointercapture']) {
    toolbar.addEventListener(type, event => { if (drag?.pointer === event.pointerId) finish(); });
  }
  window.addEventListener('blur', finish);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !drag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish();
  }, true);
}
