import { setupUpdates } from './updates.js';
import { $, ask, button, dateLabel, element, setupCommon, task } from './common.js';
import { createProject, id, insertElement, makeElement } from './model.js';
import { repository, createRecord, recordFor, snapshot } from './storage.js';
import { encodeProject, importProject } from './format.js';
import { download, fileName } from './download.js';
import { cleanHTML } from './rich-text.js';
import { boardBounds } from './geometry.js';

let records = [], undoDelete, generation = 0, operation;
window.plotForgeBeforeClose = () => operation;
void setupUpdates().catch(console.error);
const go = project => { location.href = `./editor.html?id=${encodeURIComponent(project.id)}`; };
const refresh = task(async () => {
  const request = ++generation;
  const latest = await repository.list();
  if (request === generation) {
    const changed = records.length !== latest.length || latest.some((record, i) => record.id !== records[i]?.id || record.revision !== records[i].revision);
    records = latest;
    if (changed || $('empty-state').hidden && !$('script-grid').children.length) render();
  }
});
function readRecord(id) {
  return repository.get(id).then(record => {
    if (!record || record.deletedAt) throw new Error('This project is no longer in the library.');
    return record;
  });
}
function thumbnail(record) {
  const preview = element('div', 'board-thumbnail');
  const shapes = record.preview ?? [];
  if (!shapes.length) return preview;
  const box = boardBounds(shapes, 28);
  const width = Math.max(box.width, box.height * 1.4);
  const height = Math.max(box.height, box.width / 1.4);
  for (const shape of shapes) {
    const mark = element('span', `thumb-element thumb-${shape.type}`);
    mark.style.cssText = `left:${50 + (shape.x - box.left - box.width / 2) / width * 100}%;top:${50 + (shape.y - box.top - box.height / 2) / height * 100}%;width:${shape.w / width * 100}%;height:${shape.h / height * 100}%;transform:rotate(${shape.angle ?? 0}deg)`;
    if (shape.fill) mark.style.backgroundColor = shape.fill;
    preview.append(mark);
  }
  return preview;
}
function render() {
  const query = $('search').value.toLowerCase().trim();
  const visible = records.filter(record => record.title.toLowerCase().includes(query));
  const sort = $('sort').value;
  visible.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : (b.modifiedAt - a.modifiedAt) * (sort === 'oldest' ? -1 : 1));
  $('library-count').textContent = `${records.length} ${records.length === 1 ? 'project' : 'projects'}`;
  const cards = document.createDocumentFragment();
  for (const record of visible) {
    const card = element('article', 'script-card');
    const preview = button('', () => go(record), 'script-preview');
    preview.setAttribute('aria-label', `Open ${record.title}`);
    preview.append(thumbnail(record));
    const body = element('div', 'card-body');
    const menu = element('details', 'card-menu');
    const trigger = element('summary', null, '⋯');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', `Options for ${record.title}`);
    const options = element('div', 'card-menu-options');
    const action = (label, work, style) => button(label, task(async () => { menu.open = false; await work(); }), style);
    options.append(
      action('Rename', async () => {
        const title = await ask('Rename project', 'Choose a name for this project.', record.title);
        if (!title || title === record.title) return;
        const latest = await readRecord(record.id);
        await repository.put(recordFor({ ...latest.recovery.document, title }), latest.revision);
      }),
      action('Duplicate', async () => {
        const { recovery } = await readRecord(record.id);
        const title = (record.title + ' copy').slice(0, 160);
        await createRecord({ ...recovery.document, id: id(), title, createdAt: Date.now() });
      }),
      action('Export .plf', async () => {
        const latest = await readRecord(record.id);
        await download(await encodeProject(latest.recovery.document, repository.getAsset), fileName(latest.title, 'plf'));
      }),
      action('Export root canvas as PDF', async () => {
        const { recovery, title } = await readRecord(record.id);
        const { exportCanvas } = await import('./export-canvas.js');
        const project = recovery.document;
        await download(await exportCanvas(project, project.boards[project.root], repository, 'pdf'), fileName(title, 'pdf'));
      }),
      action('Delete', async () => {
        if (!await ask('Delete from the library?', `Remove “${record.title}” from your library? You can undo this removal.`, undefined, 'Delete')) return;
        const latest = await readRecord(record.id);
        await snapshot(latest.recovery.document, 'Before Library Removal');
        undoDelete = await repository.archive(latest.id, latest.revision);
        $('library-notice').hidden = false;
      }, 'delete-script'),
    );
    menu.append(trigger, options);
    menu.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(menu.open));
      if (menu.open) for (const other of document.querySelectorAll('.card-menu[open]')) if (other !== menu) other.open = false;
    });
    const time = element('time', null, `Edited ${dateLabel(record.modifiedAt)}`);
    time.dateTime = new Date(record.modifiedAt).toISOString();
    const { Canvases: boards, Elements: elements } = record.stats;
    body.append(menu, element('span', 'file-badge', 'SAVED LOCALLY'), button(record.title, () => go(record), 'card-title'), time,
      element('div', 'card-filename', `${boards} ${boards === 1 ? 'canvas' : 'canvases'} · ${elements} ${elements === 1 ? 'element' : 'elements'}`));
    card.append(preview, body);
    cards.append(card);
  }
  $('script-grid').replaceChildren(cards);
  $('empty-state').hidden = Boolean(visible.length);
  $('empty-title').hidden = !records.length;
  $('empty-text').textContent = records.length ? 'Try another title or clear your search.' : 'Create a project or open a .plf file to start your library.';
  $('sample-project').hidden = Boolean(records.length);
}
async function create(work) {
  if (operation) return;
  $('new-project').disabled = $('open-project').disabled = true;
  operation = Promise.resolve().then(work).then(createRecord);
  try { go(await operation); }
  finally { operation = undefined; $('new-project').disabled = $('open-project').disabled = false; }
}
function sample() {
  let project = createProject('The Last Signal');
  const board = makeElement('canvas', 345, 115, { title: 'Characters' });
  project = insertElement(project, project.root, makeElement('note', 85, 95, {
    title: 'The first transmission', html: 'At midnight, the radio repeats a message from a city that no longer exists.',
  }));
  project = insertElement(project, project.root, board);
  project = insertElement(project, board.boardId, makeElement('note', 100, 100, { title: 'Radio operator', html: 'What do they recognize in the voice?' }));
  return project;
}
$('new-project').onclick = task(() => create(() => createProject()));
$('sample-project').onclick = task(() => create(sample));
$('open-project').onclick = () => $('import-file').click();
$('import-file').onchange = task(async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await create(() => importProject(file, repository, cleanHTML));
});
$('undo-delete-script').onclick = task(async () => {
  if (!undoDelete) return;
  await repository.restore(undoDelete.id, undoDelete.revision);
  undoDelete = null;
  $('library-notice').hidden = true;
});
$('search').oninput = render;
$('sort').onchange = task(async () => { render(); await repository.setPreference('library-sort', $('sort').value); });
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.card-menu[open]')) if (!menu.contains(event.target)) menu.open = false; });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const menu of document.querySelectorAll('.card-menu[open]')) { menu.open = false; menu.querySelector('summary').focus(); }
});
repository.subscribe(refresh);
window.addEventListener('pageshow', refresh);
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setupCommon();
try {
  $('sort').value = await repository.getPreference('library-sort', 'recent');
  await refresh();
  render();
} catch (error) {
  $('library-error').textContent = error.message;
  $('library-error').hidden = false;
} finally {
  $('new-project').disabled = $('open-project').disabled = false;
}
