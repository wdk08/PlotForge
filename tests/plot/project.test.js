import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  connect, createProject, extractSelection, id, insertElement, insertSelection, layer, makeElement,
  removeSelection, statistics, updateBoard, validateProject,
} from '../../js/plot/model.js';
import { boardBounds, endpoints, fitView, resizeElement, snapMove, worldAt, zoomAt } from '../../js/plot/geometry.js';
import { projectHistory, pruneViews } from '../../js/plot/history.js';
import { decodeProject, encodeProject, importProject } from '../../js/plot/format.js';
import { createRepository } from '../../js/plot/browser-store.js';
import { createRecord, recordFor, snapshot } from '../../js/plot/storage.js';
import { autosave } from '../../js/plot/autosave.js';

globalThis.crypto ??= webcrypto;
function add(project, board, type, options) {
  const model = makeElement(type, 40, 50, options);
  return [insertElement(project, board, model), model];
}
test('nested hierarchy, duplicate IDs, history, viewport and recursive removal', () => {
  let project = createProject('Plot');
  const history = projectHistory();
  let board = project.root;
  const path = [];
  for (let i = 0; i < 800; i++) {
    let card;
    [project, card] = add(project, board, 'canvas', { title: `Chapter ${i}` });
    path.push(card);
    board = card.boardId;
  }
  let note;
  [project, note] = add(project, board, 'note', { html: '<b>Clue</b>' });
  project.view.byBoard[board] = { x: -1_000, y: 5_000, zoom: 2 };
  project.view.active = board;
  assert.equal(validateProject(project), project);
  assert.equal(statistics(project).Canvases, 801);
  history.record(project);
  project = pruneViews(removeSelection(project, project.root, new Set([path[0].id])));
  project.view.active = project.root;
  assert.equal(Object.keys(validateProject(project).boards).length, 1);
  project = history.undo(project);
  assert.equal(project.boards[board].elements[0].id, note.id);
  assert.equal(project.view.byBoard[board].zoom, 2);
  const fragment = extractSelection(project, project.root, new Set([path[0].id]));
  const copied = insertSelection(project, board, fragment, 50, 20);
  assert.equal(validateProject(copied.project), copied.project);
  assert.equal(statistics(copied.project).Canvases, 1601);
  const bad = structuredClone(project);
  bad.boards[board].elements.push(makeElement('canvas', 0, 0, { boardId: project.root }));
  assert.throws(() => validateProject(bad), /cycle/);
  const orphan = structuredClone(project);
  const key = id();
  orphan.boards[key] = { id: key, elements: [], connections: [] };
  assert.throws(() => validateProject(orphan), /orphaned/);
  assert.equal(Object.keys(history.redo(project).boards).length, 1);
});

test('canvas geometry fits far-away content, maintains zoom anchor, and snaps edges', () => {
  const a = makeElement('image', -90_000, 120, { w: 200, h: 100, ratio: 2 });
  const b = makeElement('shape', 420, 350, { shape: 'ellipse' });
  const box = boardBounds([a, b]);
  assert.equal(box.left, -90_000);
  const fit = fitView([a, b], 1000, 700);
  const origin = worldAt(fit, 50, 60);
  const zoom = zoomAt(fit, 50, 60, fit.zoom * 1.5);
  const anchored = worldAt(zoom, 50, 60);
  assert.ok(Math.abs(anchored.x - origin.x) < 1e-8);
  assert.ok(Math.abs(anchored.y - origin.y) < 1e-8);
  const next = resizeElement(a, 123, 5);
  assert.equal(next.w / next.h, 2);
  assert.notEqual(next.h, a.h);
  assert.equal(snapMove([a], [b], b.x - a.x - a.w + 3, 0, 1).x, b.x);
  assert.notDeepEqual(endpoints(a, b), endpoints({ ...a, x: 30 }, b));
});

test('connections stay with copies and are pruned when an endpoint is removed', () => {
  let project = createProject();
  let a, b;
  [project, a] = add(project, project.root, 'note');
  [project, b] = add(project, project.root, 'shape');
  const board = connect(project.boards[project.root], a.id, b.id);
  project = updateBoard(project, board);
  assert.deepEqual(layer(board, new Set([a.id]), true).elements.map(model => model.id), [b.id, a.id]);
  const ids = new Set([a.id, b.id]);
  const copied = insertSelection(project, project.root, extractSelection(project, project.root, ids), 30, 30);
  const links = copied.project.boards[project.root].connections;
  assert.equal(links.length, 2);
  assert.ok(copied.ids.has(links[1].from) && copied.ids.has(links[1].to));
  assert.equal(removeSelection(copied.project, project.root, new Set([a.id])).boards[project.root].connections.length, 1);
});

test('binary .plf round trip carries shared media once and validates truncated files', async () => {
  const store = createRepository(new IDBFactory());
  let project = createProject();
  let nested;
  [project, nested] = add(project, project.root, 'canvas', { title: 'Characters' });
  const keys = [];
  for (const [type, mime] of [['image', 'image/png'], ['audio', 'audio/wav'], ['video', 'video/mp4']]) {
    const asset = id();
    keys.push(asset);
    await store.putAsset(asset, new Blob([new Uint8Array([0, 255, 41])], { type: mime }));
    [project] = add(project, nested.boardId, type, { asset, name: type, mime });
    if (type === 'image') [project] = add(project, project.root, type, { asset, name: type, mime });
  }
  const items = [{ id: id(), text: 'Answered', done: true }, { id: id(), text: 'Pending', done: false }];
  [project] = add(project, nested.boardId, 'list', { items });
  [project] = add(project, nested.boardId, 'text', { html: '<h2>Premise</h2>' });
  project.view = { active: nested.boardId, byBoard: { [project.root]: { x: 23, y: -400, zoom: .8 } } };
  const blob = await encodeProject(project, store.getAsset);
  const decoded = await decodeProject(blob);
  assert.deepEqual(decoded.project, project);
  assert.deepEqual([...decoded.assets.keys()].sort(), keys.sort());
  for (const bytes of decoded.assets.values()) assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()), new Uint8Array([0, 255, 41]));
  await assert.rejects(decodeProject(blob.slice(0, -1)), /media/);
  await createRecord(project, store);
  const imported = await importProject(blob, store);
  assert.notEqual(imported.id, project.id);
  assert.notEqual(imported.boards[nested.boardId].elements[0].asset, project.boards[nested.boardId].elements[0].asset);
  assert.deepEqual(imported.boards[nested.boardId].elements[3].items, items);
});

test('browser storage recovers saved revisions and isolates profiles', async () => {
  const factory = new IDBFactory();
  const dev = createRepository(factory, 'plotforge-development');
  const prod = createRepository(factory, 'plotforge-production');
  const source = createProject();
  const record = await createRecord(source, dev);
  const states = [];
  const saving = autosave(record, (state, error) => states.push([state, error]), dev, 10);
  saving.queue({ ...source, title: 'First edit' });
  const pending = saving.flush();
  saving.queue({ ...source, title: 'Latest edit' });
  await pending;
  const reopened = createRepository(factory, 'plotforge-development');
  const latest = await reopened.get(source.id);
  assert.equal(latest.title, 'Latest edit');
  assert.equal(latest.revision, 3);
  assert.equal(states.at(-1)[0], 'Saved locally');
  assert.equal(await prod.get(source.id), undefined);
  await dev.setPreference('library-sort', 'title');
  assert.equal(await prod.getPreference('library-sort', 'recent'), 'recent');
  await snapshot(latest.recovery.document, 'Manual Backup', dev);
  assert.equal((await reopened.listVersions(source.id))[0].project.title, 'Latest edit');
  const removed = await reopened.archive(source.id, latest.revision);
  await assert.rejects(reopened.put(recordFor(source), latest.revision), { name: 'StorageConflictError' });
  assert.deepEqual(await dev.list(), []);
  await reopened.restore(source.id, removed.revision);
  assert.equal((await dev.list())[0].title, 'Latest edit');
});

test('autosave keeps the latest failed edit available for retry or export', async () => {
  const original = createProject();
  let fail = true, value;
  const saving = autosave({ revision: 1 }, () => {}, {
    async put(record) { if (fail) throw new Error('Disk full'); value = record; return { revision: 2 }; },
  });
  saving.queue({ ...original, title: 'Still here' });
  await assert.rejects(saving.flush(), /Disk full/);
  assert.ok(saving.dirty);
  fail = false;
  await saving.flush();
  assert.equal(value.title, 'Still here');
  assert.equal(saving.dirty, false);
});

test('browser storage assembles a multi-chunk asset and preserves it on a conflicting write', async () => {
  const store = createRepository(new IDBFactory());
  const asset = id();
  const length = 4 * 1024 * 1024 + 5;
  const bytes = new Uint8Array(length);
  bytes[0] = 25;
  bytes[length - 1] = 75;
  await store.putAsset(asset, new Blob([bytes], { type: 'video/mp4' }));
  await assert.rejects(store.putAsset(asset, new Blob([new Uint8Array([2])])), { name: 'ConstraintError' });
  assert.ok(await store.hasAsset(asset));
  const stored = await store.getAsset(asset);
  assert.equal(stored.type, 'video/mp4');
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
});

test('empty media cards round-trip without generating assets', async () => {
  let project = createProject();
  let nested;
  [project, nested] = add(project, project.root, 'canvas');
  for (const type of ['image', 'audio', 'video']) [project] = add(project, nested.boardId, type);
  const file = await encodeProject(project, () => { throw new Error('Unexpected media read'); });
  const decoded = await decodeProject(file);
  assert.deepEqual(decoded.project, project);
  assert.equal(decoded.assets.size, 0);
  const corrupted = structuredClone(project);
  corrupted.boards[nested.boardId].elements[0].name = 'unbound.png';
  assert.throws(() => validateProject(corrupted), /Invalid media element/);
});
