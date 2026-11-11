import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const board = page => page.locator('#plot-canvas');
const current = page => page.locator('#breadcrumbs [aria-current]');
const card = (page, type) => page.locator(`[data-type="${type}"]`);
const title = page => page.getByRole('textbox', { name: 'Project name' });

async function saved(page) { await expect(page.locator('#save-state')).toHaveText('Saved locally'); }
async function create(page, name) {
  await page.goto('/');
  await page.locator('#new-project').click();
  await expect(page).toHaveURL(/editor\.html\?id=/);
  await saved(page);
  if (name) { await title(page).fill(name); await title(page).press('Enter'); await saved(page); }
}
async function drag(page, node, dx, dy) {
  await expect(node).toBeVisible();
  const box = await node.evaluate(element => element.getBoundingClientRect().toJSON());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 9 });
  await page.mouse.up();
}
async function worldPosition(node) {
  return node.evaluate(element => [element.style.left, element.style.top, element.style.width, element.style.height]);
}
async function canvasExport(page, name) {
  const menu = page.locator('.export-menu:not(.browser-download)');
  await menu.locator('summary').click();
  const downloading = page.waitForEvent('download');
  await menu.getByRole('button', { name }).click();
  return downloading;
}
async function add(page, type) {
  await page.locator(`[data-insert="${type}"]`).press('Enter');
  return card(page, type).last();
}

test('nested canvases preserve the immediate parent viewport, selections and deep contents', async ({ page }) => {
  await create(page, 'My Novel');
  const characters = await add(page, 'canvas');
  await page.getByLabel('Title', { exact: true }).fill('Characters');
  await page.getByLabel('Title', { exact: true }).press('Tab');
  await drag(page, characters, -145, -60);
  await saved(page);
  const moved = await worldPosition(characters);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  const rootTransform = await page.locator('#plot-stage').evaluate(node => node.style.transform);
  await characters.dblclick();
  await expect(current(page)).toHaveText('Characters');

  const main = await add(page, 'canvas');
  await page.getByLabel('Title', { exact: true }).fill('Main Characters');
  await page.getByLabel('Title', { exact: true }).press('Tab');
  await main.dblclick();
  await expect(current(page)).toHaveText('Main Characters');
  const protagonist = await add(page, 'canvas');
  await page.getByLabel('Title', { exact: true }).fill('Protagonist');
  await page.getByLabel('Title', { exact: true }).press('Tab');
  await protagonist.dblclick();
  const note = await add(page, 'note');
  await note.dblclick();
  await page.getByRole('textbox', { name: 'Note body' }).fill('A mysterious past');
  await page.getByRole('textbox', { name: 'Note body' }).press('Escape');
  await saved(page);

  await page.reload();
  await expect(current(page)).toHaveText('Protagonist');
  await expect(note).toContainText('A mysterious past');
  await page.locator('#back').click();
  await expect(current(page)).toHaveText('Main Characters');
  await page.locator('#breadcrumbs').getByRole('button', { name: 'My Novel', exact: true }).click();
  await expect(current(page)).toHaveText('My Novel');
  await expect(page.locator('#plot-stage')).toHaveCSS('transform', /matrix\(1\.25/);
  expect(await page.locator('#plot-stage').evaluate(node => node.style.transform)).toBe(rootTransform);
  expect(await worldPosition(characters)).toEqual(moved);
  await characters.dblclick();
  await page.locator('#back').click();
  await expect(characters).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog').getByText('Delete nested canvas?')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(characters).toBeVisible();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(characters).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(characters).toBeVisible();
  await page.locator('#board-tree').getByRole('button', { name: 'Protagonist', exact: true }).click();
  await expect(note).toContainText('A mysterious past');
});

test('edits rich text and checklists, connects, moves, resizes, copies and exports a board', async ({ page }, info) => {
  await create(page, 'Storyboard');
  const text = await add(page, 'text');
  const editable = page.getByRole('textbox', { name: 'Text content' });
  await editable.fill('Inciting incident');
  await editable.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(editable.locator('b, strong')).toContainText('Inciting incident');
  await editable.press('Escape');
  await drag(page, text, -190, -95);
  await add(page, 'list');
  const list = card(page, 'list');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await page.getByRole('textbox', { name: 'Item 1' }).fill('Find the clue');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await page.getByRole('textbox', { name: 'Item 2' }).fill('Follow the signal');
  await page.getByRole('textbox', { name: 'Item 2' }).press('Tab');
  await page.getByRole('button', { name: 'Move item up' }).last().click();
  await expect(list.locator('li').first()).toContainText('Follow the signal');
  await list.getByRole('checkbox', { name: 'Find the clue' }).check();
  await expect(list.getByRole('checkbox', { name: 'Follow the signal' })).not.toBeChecked();
  await saved(page);
  await drag(page, list.locator('.element-title'), 140, 70);
  const before = await worldPosition(list);
  await drag(page, list.getByRole('button', { name: 'Resize element' }), 66, 34);
  await expect.poll(() => worldPosition(list)).not.toEqual(before);
  const resized = await worldPosition(list);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => worldPosition(list)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => worldPosition(list)).toEqual(resized);

  await page.getByRole('button', { name: 'Connect', exact: false }).filter({ hasText: 'Connect' }).first().click();
  await text.click();
  const connection = page.locator('#plot-links [data-connection]');
  await expect(connection).toHaveCount(1);
  await page.getByLabel('Line style').selectOption('dashed');
  await expect(connection.locator('.connection-visible').first()).toHaveAttribute('stroke-dasharray', '7 5');
  const old = await connection.locator('.connection-visible').first().getAttribute('x1');
  await drag(page, list.locator('.element-title'), 65, 35);
  await expect(connection.locator('.connection-visible').first()).not.toHaveAttribute('x1', old);
  await text.click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-status')).toHaveText('2 selected');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('[data-element]')).toHaveCount(4);
  await expect(connection).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-element]')).toHaveCount(2);

  const box = await board(page).boundingBox();
  await board(page).focus();
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 36, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 165, box.y + 130, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(page.locator('#plot-stage')).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 129, 90\)/);
  await page.mouse.wheel(0, -180);
  await expect(page.locator('#plot-stage')).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 129, 270\)/);
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  await page.getByRole('button', { name: 'Fit all elements' }).click();
  await saved(page);
  await page.reload();
  await expect(card(page, 'text').locator('.rich-content')).toContainText('Inciting incident');
  await expect(list.getByRole('checkbox', { name: 'Find the clue' })).toBeChecked();
  await page.screenshot({ path: info.outputPath('workspace.png') });
  const png = await canvasExport(page, 'Export Canvas as PNG');
  const pngPath = info.outputPath('canvas.png');
  await png.saveAs(pngPath);
  const data = await readFile(pngPath);
  expect(data.subarray(1, 4).toString()).toBe('PNG');
  expect(data.readUInt32BE(16)).toBeGreaterThan(500);
  expect(data.length).toBeGreaterThan(7000);
  const pdf = await canvasExport(page, 'Export Canvas as PDF');
  const pdfPath = info.outputPath('canvas.pdf');
  await pdf.saveAs(pdfPath);
  expect((await readFile(pdfPath)).subarray(0, 4).toString()).toBe('%PDF');
});

async function dropFile(page, target, name, mime, point = {}) {
  const bytes = await readFile(fixture(name));
  const transfer = await page.evaluateHandle(({ bytes, name, mime }) => {
    const files = new DataTransfer();
    files.items.add(new File([new Uint8Array(bytes)], name, { type: mime }));
    return files;
  }, { bytes: [...bytes], name, mime });
  await target.dispatchEvent('drop', { dataTransfer: transfer, ...point });
  await transfer.dispose();
}

async function pickFile(page, control, file) {
  const opening = page.waitForEvent('filechooser', { timeout: 5000 });
  await control.click();
  await (await opening).setFiles(file);
}

test('media placeholders upload, replace, play and survive a portable round trip', async ({ page }, info) => {
  await create(page, 'Media test');
  const box = await board(page).boundingBox();
  await dropFile(page, board(page), 'ochre.png', 'image/png', { clientX: box.x + 40, clientY: box.y + 50 });
  await expect(card(page, 'image').locator('img')).toHaveJSProperty('naturalWidth', 32);
  const original = await add(page, 'image');
  const upload = original.getByRole('button', { name: 'Upload Image' });
  await expect(upload).toBeVisible();
  const id = await original.getAttribute('data-element');
  const image = page.locator(`[data-element="${id}"]`);
  await drag(page, image.locator('.placeholder-grip'), -80, 130);
  const bounds = await worldPosition(image);
  await pickFile(page, upload, []);
  await expect(upload).toBeVisible();
  await pickFile(page, upload, fixture('ochre.png'));
  await expect(image.locator('img')).toHaveJSProperty('naturalWidth', 32);
  expect(await worldPosition(image)).toEqual(bounds);
  await expect(card(page, 'image')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(upload).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(image.locator('img')).toHaveAttribute('alt', 'ochre.png');

  await image.hover();
  await pickFile(page, image.getByRole('button', { name: 'Replace Image' }), {
    name: 'replacement.png', mimeType: 'image/png', buffer: await readFile(fixture('ochre.png')),
  });
  await expect(image.locator('img')).toHaveAttribute('alt', 'replacement.png');
  expect(await worldPosition(image)).toEqual(bounds);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(image.locator('img')).toHaveAttribute('alt', 'ochre.png');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(image.locator('img')).toHaveAttribute('alt', 'replacement.png');

  const audioCard = await add(page, 'audio');
  await expect(audioCard.locator('.placeholder-wave')).toBeVisible();
  const audioBounds = await worldPosition(audioCard);
  await pickFile(page, audioCard.getByRole('button', { name: 'Upload Audio' }), fixture('tone.wav'));
  const audio = audioCard.locator('audio');
  await expect(audio).toHaveJSProperty('controls', true);
  await expect(audio).toHaveJSProperty('paused', true);
  await expect.poll(() => audio.evaluate(node => node.duration)).toBe(1);
  expect(await worldPosition(audioCard)).toEqual(audioBounds);

  const videoCard = await add(page, 'video');
  await pickFile(page, videoCard.getByRole('button', { name: 'Upload Video' }), []);
  await expect(videoCard.locator('video')).toHaveCount(0);
  const videoBounds = await worldPosition(videoCard);
  await dropFile(page, videoCard, 'ochre.mp4', 'video/mp4');
  const video = videoCard.locator('video');
  await expect(video).toHaveJSProperty('controls', true);
  await expect(video).toHaveJSProperty('paused', true);
  await expect.poll(() => video.evaluate(node => node.videoWidth)).toBe(48);
  expect(await worldPosition(videoCard)).toEqual(videoBounds);
  for (const player of [audio, video]) {
    await player.evaluate(async media => {
      media.volume = .35;
      media.currentTime = .25;
      await media.play();
      media.pause();
    });
    await expect(player).toHaveJSProperty('volume', .35);
  }
  const beforeMediaWheel = await canvasTransform(page);
  await video.dispatchEvent('wheel', { deltaX: 25, deltaY: 30 });
  await audio.dispatchEvent('wheel', { deltaY: -40 });
  expect(await canvasTransform(page)).toEqual(beforeMediaWheel);
  const nested = await add(page, 'canvas');
  await nested.dblclick();
  const empty = await add(page, 'audio');
  await expect(empty.getByRole('button', { name: 'Upload Audio' })).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(card(page, 'audio').getByRole('button', { name: 'Upload Audio' })).toBeVisible();
  const download = await canvasExport(page, 'Export Project (.plf)');
  const path = info.outputPath('media.plf');
  await download.saveAs(path);
  expect((await readFile(path)).subarray(0, 4).toString()).toBe('PLF\0');
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page.locator('#open-project')).toBeEnabled();
  await page.locator('#import-file').setInputFiles(path);
  await expect(page).toHaveURL(/editor\.html\?id=/);
  await saved(page);
  await expect(title(page)).toHaveValue('Media test');
  await expect(card(page, 'audio').getByRole('button', { name: 'Upload Audio' })).toBeVisible();
  await page.locator('#back').click();
  await expect(image.locator('img')).toHaveJSProperty('naturalWidth', 32);
  await expect(image.locator('img')).toHaveAttribute('alt', 'replacement.png');
  await expect.poll(() => card(page, 'audio').locator('audio').evaluate(node => node.duration)).toBe(1);
  await expect.poll(() => card(page, 'video').locator('video').evaluate(node => node.videoWidth)).toBe(48);
});

test('library actions, preferences and local backups survive navigation', async ({ page }) => {
  await create(page, 'First Project');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Open Version History' }).click();
  await page.getByRole('button', { name: 'Back Up Now' }).click();
  await expect(page.locator('#version-list')).toContainText('Manual Backup');
  await page.getByRole('button', { name: 'Close version history' }).click();
  await page.getByRole('link', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Options for First Project' }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open First Project copy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Options for First Project copy' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Second Project');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Second Project', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('Second');
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Options for Second Project' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.script-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.script-card')).toHaveCount(1);
  await page.getByLabel('Sort projects').selectOption('title');
  await page.reload();
  await expect(page.getByLabel('Sort projects')).toHaveValue('title');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('production application launches, saves, and reopens offline after the initial visit', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit network emulation does not support this service-worker assertion');
  await page.goto('http://127.0.0.1:4174/');
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.locator('#new-project').click();
  await expect(page).toHaveURL(/editor\.html\?id=/);
  await saved(page);
  await title(page).fill('Offline Project');
  await title(page).press('Enter');
  await saved(page);
  await page.reload();
  await expect(title(page)).toHaveValue('Offline Project');
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page.getByRole('button', { name: 'Open Offline Project', exact: true })).toBeVisible();
});

test('group movement and clipboard commands preserve a selection across cut and paste', async ({ page }) => {
  await create(page, 'Group Selection');
  const note = await add(page, 'note');
  await drag(page, note, -190, 55);
  await page.locator('[data-insert=shape]').press('Enter');
  await page.getByRole('menuitem', { name: 'Ellipse', exact: false }).click();
  const shape = card(page, 'shape');
  await note.click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-status')).toHaveText('2 selected');
  const oldNote = (await worldPosition(note)).map(parseFloat);
  const oldShape = (await worldPosition(shape)).map(parseFloat);
  await drag(page, note, -32, -45);
  const movedNote = (await worldPosition(note)).map(parseFloat);
  const movedShape = (await worldPosition(shape)).map(parseFloat);
  expect(movedNote[0] - oldNote[0]).toBeCloseTo(movedShape[0] - oldShape[0]);
  expect(movedNote[1] - oldNote[1]).toBeCloseTo(movedShape[1] - oldShape[1]);
  expect(movedNote[0]).not.toBe(oldNote[0]);

  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await board(page).dispatchEvent('copy', { clipboardData: transfer });
  await board(page).dispatchEvent('paste', { clipboardData: transfer });
  await expect(page.locator('[data-element]')).toHaveCount(4);
  await board(page).dispatchEvent('cut', { clipboardData: transfer });
  await expect(page.locator('[data-element]')).toHaveCount(2);
  await board(page).dispatchEvent('paste', { clipboardData: transfer });
  await expect(page.locator('[data-element]')).toHaveCount(4);
});

test('every toolbar tool drags to exact world coordinates and cancels outside or with Escape', async ({ page }) => {
  await create(page, 'Drop targets');
  const tools = type => page.locator(`[data-insert="${type}"]`);
  const preview = page.locator('.toolbar-drag-preview');
  const canvas = board(page);
  const box = await canvas.boundingBox();
  await tools('note').click();
  await expect(canvas.locator('[data-element]')).toHaveCount(0);

  async function grab(type) {
    const rect = await tools(type).boundingBox();
    await page.mouse.move(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
    await page.mouse.down();
  }
  async function drop(type, x, y) {
    const clientX = Math.round(box.x + x), clientY = Math.round(box.y + y);
    const expected = await page.locator('#plot-stage').evaluate((stage, { x, y }) => {
      const matrix = new DOMMatrix(getComputedStyle(stage).transform).inverse();
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return [point.x, point.y];
    }, { x: clientX - box.x, y: clientY - box.y });
    await grab(type);
    await page.mouse.move(clientX, clientY, { steps: 6 });
    await expect(preview).toBeVisible();
    await expect(canvas).toHaveClass(/toolbar-drop-over/);
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
    await expect(card(page, type)).toHaveCount(1);
    const [worldX, worldY] = (await worldPosition(card(page, type))).map(parseFloat);
    expect(worldX).toBeCloseTo(expected[0]);
    expect(worldY).toBeCloseTo(expected[1]);
  }

  await grab('note');
  await page.mouse.move(box.x - 50, box.y + 90, { steps: 6 });
  await expect(preview).toBeVisible();
  await expect(canvas).not.toHaveClass(/toolbar-drop-over/);
  await page.mouse.up();
  await expect(canvas.locator('[data-element]')).toHaveCount(0);

  await grab('note');
  await page.mouse.move(box.x + 120, box.y + 65, { steps: 6 });
  await expect(preview).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await page.mouse.up();
  await expect(canvas.locator('[data-element]')).toHaveCount(0);

  await drop('text', 70, 65);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  const translation = () => page.locator('#plot-stage').evaluate(stage => new DOMMatrix(getComputedStyle(stage).transform).e);
  const beforePan = await translation();
  await canvas.focus();
  await page.keyboard.down('Space');
  await page.mouse.move(box.x + 40, box.y + 560);
  await page.mouse.down();
  await page.mouse.move(box.x + 123, box.y + 616, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect.poll(translation).toBeCloseTo(beforePan + 83);
  const stageTransform = await page.locator('#plot-stage').getAttribute('style');
  for (const [type, x, y] of [
    ['note', 80, 170], ['list', 380, 70], ['image', 635, 80], ['audio', 100, 445],
    ['video', 380, 380], ['shape', 620, 350], ['canvas', 710, 545],
  ]) await drop(type, x, y);
  expect(await page.locator('#plot-stage').getAttribute('style')).toBe(stageTransform);
  await expect(card(page, 'image').getByRole('button', { name: 'Upload Image' })).toBeVisible();
  await expect(card(page, 'video').getByRole('button', { name: 'Upload Video' })).toBeVisible();
  await expect(card(page, 'audio').getByRole('button', { name: 'Upload Audio' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card(page, 'canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(card(page, 'canvas')).toHaveCount(1);
  await card(page, 'canvas').dblclick();
  await expect(current(page)).toHaveText('Untitled Canvas');
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  await drop('image', 260, 140);
  await expect(card(page, 'image').getByRole('button', { name: 'Upload Image' })).toBeVisible();
});

async function dragTool(page, type, x, y) {
  const canvas = await board(page).boundingBox();
  const tool = await page.locator(`[data-insert="${type}"]`).boundingBox();
  await page.mouse.move(tool.x + tool.width / 2, tool.y + tool.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + x, canvas.y + y, { steps: 5 });
  await page.mouse.up();
  return card(page, type).last();
}

async function canvasTransform(page) {
  return page.locator('#plot-stage').evaluate(stage => {
    const { a, e, f } = new DOMMatrix(getComputedStyle(stage).transform);
    return [a, e, f];
  });
}

test('marquee selects intersecting cards, adds with Shift and works after zoom and pan', async ({ page }) => {
  await create(page, 'Marquee');
  const canvas = board(page);
  const note = await dragTool(page, 'note', 100, 120);
  const shape = await dragTool(page, 'shape', 420, 120);
  const list = await dragTool(page, 'list', 100, 380);
  const nested = await dragTool(page, 'canvas', 520, 420);
  const box = await canvas.boundingBox();
  const selected = canvas.locator('.plot-element.selected');
  const selectionBox = canvas.locator('.selection-box');
  async function marquee(x, y, endX, endY, { additive = false, cancel = false } = {}) {
    if (additive) await page.keyboard.down('Shift');
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + endX, box.y + endY, { steps: 6 });
    await expect(selectionBox).toBeVisible();
    if (cancel) {
      await page.keyboard.press('Escape');
      await page.mouse.move(box.x + endX + 12, box.y + endY + 10);
    }
    await page.mouse.up();
    if (additive) await page.keyboard.up('Shift');
    await expect(selectionBox).toHaveCount(0);
  }

  await marquee(60, 85, 445, 160);
  await expect(selected).toHaveCount(2);
  await expect(note).toHaveClass(/selected/);
  await expect(shape).toHaveClass(/selected/);
  await expect(list).not.toHaveClass(/selected/);
  const before = await Promise.all([note, shape].map(worldPosition));
  await drag(page, note, 40, 20);
  const after = await Promise.all([note, shape].map(worldPosition));
  expect(after.map((p, i) => parseFloat(p[0]) - parseFloat(before[i][0]))).toEqual([40, 40]);
  await shape.click({ modifiers: ['Shift'] });
  await expect(selected).toHaveCount(1);
  await shape.click({ modifiers: ['Shift'] });
  await expect(selected).toHaveCount(2);
  await marquee(65, 355, 135, 410, { additive: true });
  await expect(selected).toHaveCount(3);
  await expect(list).toHaveClass(/selected/);
  await page.mouse.click(box.x + 20, box.y + 25);
  await expect(selected).toHaveCount(0);

  await canvas.press('ControlOrMeta+Equal');
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  const [, x, y] = await canvasTransform(page);
  await page.mouse.move(box.x + 20, box.y + 560);
  await page.mouse.wheel(12, 15);
  await expect.poll(() => canvasTransform(page)).toEqual([1.25, x - 12, y - 15]);
  await marquee(25, 35, 475, 125, { cancel: true });
  await expect(selected).toHaveCount(0);
  await marquee(25, 35, 475, 125);
  await expect(selected).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(note).toHaveCount(0);
  await expect(shape).toHaveCount(0);
  await expect(list).toBeVisible();

  await list.click({ position: { x: 40, y: 20 } });
  await page.locator('#board-tree').getByRole('button', { name: 'Untitled Canvas', exact: true }).click();
  await expect(nested).toHaveCount(0);
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  const child = await dragTool(page, 'note', 160, 150);
  await page.keyboard.press('Escape');
  await marquee(100, 110, 195, 185);
  await expect(child).toHaveClass(/selected/);
  await page.locator('#back').click();
  await expect(list).toHaveClass(/selected/);
  await expect(nested).not.toHaveClass(/selected/);
});

test('wheel pans both axes, scrollable cards keep their scroll, and keyboard zoom stays on the active canvas', async ({ page }) => {
  await create(page, 'Viewport');
  const canvas = board(page);
  const box = await canvas.boundingBox();
  const transform = () => canvasTransform(page);
  await page.mouse.move(box.x + 45, box.y + 55);
  await page.mouse.wheel(0, 90);
  await expect.poll(transform).toEqual([1, 0, -90]);
  await page.mouse.wheel(-70, 0);
  await expect.poll(transform).toEqual([1, 70, -90]);
  await page.mouse.wheel(20, -30);
  await expect.poll(transform).toEqual([1, 50, -60]);
  const viewport = await canvas.evaluate(el => [el.clientWidth, el.clientHeight]);
  await canvas.press('ControlOrMeta+Equal');
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  const [, x, y] = await transform();
  expect((viewport[0] / 2 - x) / 1.25).toBeCloseTo(viewport[0] / 2 - 50);
  expect((viewport[1] / 2 - y) / 1.25).toBeCloseTo(viewport[1] / 2 + 60);
  await canvas.press('ControlOrMeta+NumpadSubtract');
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  await canvas.press('ControlOrMeta+Shift+Equal');
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  await canvas.press('ControlOrMeta+Numpad0');
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  await canvas.press('ControlOrMeta+NumpadAdd');
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  await canvas.press('ControlOrMeta+Minus');
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  await canvas.press('ControlOrMeta+Equal');
  await canvas.press('ControlOrMeta+Digit0');
  await expect(page.locator('#zoom-reset')).toHaveText('100%');

  const text = await add(page, 'text');
  const editor = text.getByRole('textbox', { name: 'Text content' });
  await editor.fill(Array.from({ length: 28 }, (_, i) => `Line ${i + 1}`).join('\n'));
  const editingKeyAllowed = await editor.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', {
    key: '=', code: 'Equal', ctrlKey: true, bubbles: true, cancelable: true,
  })));
  expect(editingKeyAllowed).toBe(true);
  const beforeTextScroll = await transform();
  await editor.hover();
  await editor.evaluate(el => { el.scrollTop = 0; });
  await page.mouse.wheel(0, 55);
  await expect.poll(() => editor.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await transform()).toEqual(beforeTextScroll);
  await editor.press('Escape');
  const richContent = text.locator('.rich-content');
  await richContent.hover();
  await richContent.evaluate(el => { el.scrollTop = 0; });
  await page.mouse.wheel(0, 35);
  await expect.poll(() => richContent.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await transform()).toEqual(beforeTextScroll);
  const list = await dragTool(page, 'list', 665, 105);
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Add Item', exact: true }).click();
  await list.locator('.plot-list').hover();
  await page.mouse.wheel(0, 55);
  await expect.poll(() => list.locator('.plot-list').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await transform()).toEqual(beforeTextScroll);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const rootViewport = await transform();
  const nested = await dragTool(page, 'canvas', 580, 480);
  await nested.dblclick();
  await expect(current(page)).toHaveText('Untitled Canvas');
  await expect.poll(transform).toEqual([1, 0, 0]);
  await page.mouse.move(box.x + 50, box.y + 55);
  await page.mouse.wheel(-35, 45);
  await expect.poll(transform).toEqual([1, 35, -45]);
  await canvas.press('ControlOrMeta+Equal');
  await expect(page.locator('#zoom-reset')).toHaveText('125%');
  const childViewport = await transform();
  await page.locator('#back').click();
  await expect.poll(transform).toEqual(rootViewport);
  await nested.dblclick();
  await expect.poll(transform).toEqual(childViewport);
});

test('library arrow saves nested edits and the library keeps functional copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  await expect(page.locator('#empty-text')).toContainText('Create a project or open a .plf file');
  await expect(page.getByRole('button', { name: 'Explore a sample project' })).toBeVisible();
  await expect(page.locator('.local-label, .empty-mark, .library-intro .eyebrow, .library-intro p')).toHaveCount(0);

  await create(page, 'Library Arrow');
  const arrow = page.getByRole('link', { name: 'Return to project library' });
  await expect(arrow).toHaveText('←');
  await expect(page.getByRole('link', { name: 'Back to library' }).locator('.brand-logo')).toBeVisible();
  await expect(arrow).toHaveCSS('font-size', '22px');
  await expect(page.locator('#canvas-hint')).toHaveText('Drag an element from the toolbar or drop a media file here.');
  await expect(page.locator('.outline-note, .outline-instruction span')).toHaveCount(0);
  await page.getByRole('button', { name: 'Keyboard guide' }).click();
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('Keyboard guide');
  await page.getByRole('button', { name: 'Close keyboard guide' }).click();

  const nested = await add(page, 'canvas');
  await nested.dblclick();
  await expect(page.locator('#back')).toBeVisible();
  const text = await add(page, 'text');
  await text.getByRole('textbox', { name: 'Text content' }).fill('Saved by the library arrow');
  await arrow.click();
  await expect(page.getByRole('button', { name: 'Open Library Arrow', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Library Arrow', exact: true }).click();
  await expect(current(page)).toHaveText('Untitled Canvas');
  await expect(card(page, 'text')).toContainText('Saved by the library arrow');
  await page.locator('#back').click();
  await expect(current(page)).toHaveText('Library Arrow');
  await expect(arrow).toBeVisible();
});
