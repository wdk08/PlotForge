import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { decodeProject } from '../../../js/plot/format.js';

const scene = page => page.locator('#floor-scene');
const objects = (page, type) => scene(page).locator(`[data-plan-type="${type}"]`);
const tool = (page, type) => page.locator(`[data-floor-tool="${type}"]`).click();
const field = (page, label) => page.locator('#inspector-body').getByLabel(label, { exact: true });
const choice = (page, label) => page.getByRole('combobox', { name: label, exact: true });

async function start(page) {
  await page.goto('/');
  await page.locator('#new-project').click();
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await page.locator('[data-insert=map]').press('Enter');
  await page.getByRole('button', { name: 'Floor Plan', exact: true }).click();
  await page.locator('[data-type=map]').dblclick();
  await expect(scene(page)).toBeVisible();
  await choice(page, 'Units').selectOption('cm');
  await write(page, 'Grid spacing (cm)', '25');
}
async function write(page, label, value) {
  const input = field(page, label);
  await input.fill(value);
  await input.press('Tab');
}
async function clickAt(page, x, y) {
  const box = await scene(page).boundingBox();
  await page.mouse.click(box.x + x, box.y + y);
}
async function dragTo(page, node, from, to) {
  const target = await scene(page).boundingBox();
  const source = await node.boundingBox();
  await page.mouse.move(source.x + (from?.x ?? source.width / 2), source.y + (from?.y ?? source.height / 2));
  await page.mouse.down();
  await page.mouse.move(target.x + to.x, target.y + to.y, { steps: 9 });
  await page.mouse.up();
}
async function exportAs(page, label) {
  const menu = page.locator('.export-menu:not(.browser-download)');
  await menu.locator('summary').click();
  const download = page.waitForEvent('download');
  await menu.getByRole('button', { name: label }).click();
  return readFile(await (await download).path());
}

test('floor plan draws joined rooms, keeps wall openings attached and edits furniture', async ({ page }) => {
  await start(page);
  await page.locator('#plot-canvas').focus();
  await page.keyboard.press('w');
  await expect(page.locator('[data-floor-tool=wall]')).toHaveAttribute('aria-pressed', 'true');
  await clickAt(page, 103, 105);
  await clickAt(page, 504, 96);
  await clickAt(page, 505, 402);
  await page.keyboard.press('Escape');
  const walls = objects(page, 'wall');
  await expect(walls).toHaveCount(2);
  await expect(scene(page).getByText('400 cm', { exact: true })).toBeVisible();

  await tool(page, 'room');
  await dragTo(page, scene(page), { x: 103, y: 102 }, { x: 501, y: 403 });
  const room = objects(page, 'room');
  await expect(room).toHaveCount(1);
  await expect(walls).toHaveCount(4);
  await write(page, 'Name', 'Kitchen');
  await expect(scene(page).getByText('Kitchen', { exact: true })).toBeVisible();
  await expect(field(page, 'Width (cm)')).toHaveValue('400');
  await choice(page, 'Surface').selectOption('tile');
  await choice(page, 'View').selectOption('furnished');
  await expect(room.locator('polygon[fill="url(#floor-tile)"]')).toHaveCount(1);

  await tool(page, 'door');
  await page.getByLabel('Drawing type').selectOption('double');
  await clickAt(page, 273, 103);
  const door = objects(page, 'door');
  await expect(door).toHaveCount(1);
  await choice(page, 'Swing').selectOption('left-out');
  await expect(door.locator('path[d*="v-"]')).toHaveCount(2);
  await tool(page, 'window');
  await clickAt(page, 505, 260);
  const window = objects(page, 'window');
  await expect(window).toHaveCount(1);
  await write(page, 'Width (cm)', '100');
  await expect(window.locator('rect').first()).toHaveAttribute('width', '100');

  await dragTo(page, scene(page), { x: 140, y: 100 }, { x: 140, y: 76 });
  await expect(door).toHaveAttribute('transform', /translate\([\d.]+ 75\)/);
  await clickAt(page, 411, 75);
  await expect(field(page, 'Length (cm)')).toHaveValue('400');
  await write(page, 'Thickness (cm)', '22');
  await expect(walls.first().locator('line').first()).toHaveAttribute('stroke-width', '22');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(walls.first().locator('line').first()).toHaveAttribute('stroke-width', '15');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(walls.first().locator('line').first()).toHaveAttribute('stroke-width', '22');

  await tool(page, 'furniture');
  await dragTo(page, page.getByRole('button', { name: 'Bed', exact: true }), null, { x: 213, y: 260 });
  const bed = scene(page).locator('[data-plan-type=furniture][aria-label=Bed]');
  await expect(bed).toHaveCount(1);
  await expect(bed).toHaveAttribute('transform', 'translate(225 250) rotate(0)');
  await write(page, 'Rotation (°)', '30');
  await write(page, 'Width (cm)', '180');
  await expect(bed).toHaveAttribute('transform', 'translate(225 250) rotate(30)');
  await expect(bed.locator('g').first()).toHaveAttribute('transform', 'scale(1.8 2)');
  await expect(scene(page).locator('[data-plan-handle=rotate]')).toBeVisible();
  await expect(scene(page).locator('[data-plan-handle=size]')).toBeVisible();

  await tool(page, 'furniture');
  await page.getByRole('button', { name: 'Chair', exact: true }).click();
  await clickAt(page, 422, 300);
  const chair = scene(page).locator('[data-plan-type=furniture][aria-label=Chair]');
  await expect(chair).toHaveAttribute('transform', 'translate(425 300) rotate(0)');
  await bed.click({ modifiers: ['Shift'] });
  await expect(page.locator('#selection-status')).toHaveText('2 selected');
  await dragTo(page, scene(page), { x: 225, y: 250 }, { x: 250, y: 275 });
  await expect(bed).toHaveAttribute('transform', 'translate(250 275) rotate(30)');
  await expect(chair).toHaveAttribute('transform', 'translate(450 325) rotate(0)');
});

test('floor plan reopens multiple floors and exports the active drawing', async ({ page }) => {
  await start(page);
  await tool(page, 'polygon');
  for (const [x, y] of [[100, 100], [400, 100], [400, 200], [270, 200], [270, 350], [100, 350]]) {
    await clickAt(page, x, y);
  }
  await page.keyboard.press('Enter');
  await expect(objects(page, 'room')).toHaveCount(1);
  await expect(objects(page, 'wall')).toHaveCount(6);
  await write(page, 'Name', 'First floor hall');

  await page.getByRole('button', { name: 'Add Floor', exact: true }).click();
  await page.locator('#prompt-value').fill('Upper floor');
  await page.locator('#prompt-dialog').getByRole('button', { name: 'Add Floor', exact: true }).click();
  await expect(objects(page, 'wall')).toHaveCount(0);
  await tool(page, 'stairs');
  await page.getByLabel('Drawing type').selectOption('corner');
  await clickAt(page, 250, 220);
  await expect(objects(page, 'stairs')).toHaveAttribute('aria-label', 'L-shaped stairs');
  await tool(page, 'label');
  await clickAt(page, 410, 135);
  await write(page, 'Text', 'Library');
  await expect(scene(page).getByText('Library', { exact: true })).toBeVisible();
  await choice(page, 'View').selectOption('furnished');
  await page.locator('#floor-picker').selectOption({ label: 'Ground floor' });
  await expect(scene(page).getByText('First floor hall', { exact: true })).toBeVisible();
  await page.locator('#floor-picker').selectOption({ label: 'Upper floor' });
  await expect(scene(page).getByText('Library', { exact: true })).toBeVisible();
  await expect(page.locator('#save-state')).toHaveText('Saved locally');
  await page.reload();
  await expect(page.locator('#floor-picker option:checked')).toHaveText('Upper floor');
  await expect(page.locator('#floor-style')).toHaveValue('furnished');
  await expect(scene(page).getByText('Library', { exact: true })).toBeVisible();

  const png = await exportAs(page, 'Export Canvas as PNG');
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  const pdf = await exportAs(page, 'Export Canvas as PDF');
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  const plf = await exportAs(page, 'Export Project (.plf)');
  const { project } = await decodeProject(new Blob([plf]));
  const plan = project.boards[project.view.active].plan;
  expect(plan.style).toBe('furnished');
  expect(plan.spacing).toBe(25);
  expect(plan.floors.map(floor => [floor.name, floor.objects.length])).toEqual([['Ground floor', 7], ['Upper floor', 2]]);
  expect(plan.active).toBe(plan.floors[1].id);

  await page.locator('#back').click();
  await expect(page.locator('[data-type=map]')).toContainText('2 floors');
});
