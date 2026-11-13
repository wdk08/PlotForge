import assert from 'node:assert/strict';
import test from 'node:test';
import { FURNITURE, FURNITURE_CATEGORIES } from '../../js/plot/furniture-catalog.js';
import { designFromObjects, furnitureLibraryFile, makePart, newTemplate, readFurnitureLibrary } from '../../js/plot/furniture-data.js';
import { activeFloor, makeFloorItem, makePlan, updateFloor } from '../../js/plot/floor-model.js';
import { createProject, insertElement, makeElement } from '../../js/plot/model.js';
import { decodeProject, encodeProject } from '../../js/plot/format.js';

test('catalog covers every built-in category and gives each standard bed size different dimensions', () => {
  for (const key of Object.keys(FURNITURE_CATEGORIES).filter(key => key !== 'my')) {
    assert.ok(Object.values(FURNITURE).some(item => item.category === key));
  }
  const sizes = ['twin', 'twin-xl', 'full', 'queen', 'king', 'cal-king'].map(id => {
    const { w, h } = makeFloorItem('furniture', id, { x: 0, y: 0 });
    return `${w} × ${h}`;
  });
  assert.equal(new Set(sizes).size, sizes.length);
});

test('furniture files reject invalid parts and retain independent legacy and custom items in a project', async () => {
  const bed = makeFloorItem('furniture', 'bed', { x: 10, y: 20 });
  assert.deepEqual([bed.name, bed.w, bed.h], ['Bed', 150, 200]);
  const ellipse = makeFloorItem('shape', 'circle', { x: 100, y: 20 });
  const draft = designFromObjects([bed, ellipse], { x: -65, y: -80, w: 205, h: 200 });
  assert.deepEqual(draft.design.parts.map(part => part.type), ['symbol', 'ellipse']);
  const template = { ...newTemplate('bedroom'), ...draft };
  const file = furnitureLibraryFile([template]);
  assert.deepEqual(readFurnitureLibrary(JSON.parse(JSON.stringify(file))), [template]);
  assert.throws(() => readFurnitureLibrary({ ...file, version: 2 }), /Unsupported/);
  assert.throws(() => readFurnitureLibrary(furnitureLibraryFile([template, template])), /Invalid furniture template/);
  const hostile = { ...template, design: { ...template.design, parts: [{ ...makePart('text', 0, 0), type: 'script' }] } };
  assert.throws(() => readFurnitureLibrary(furnitureLibraryFile([hostile])), /Invalid custom furniture shape/);

  const placed = makeFloorItem('furniture', template, { x: 200, y: 200 });
  template.design.parts[0].symbol = 'king';
  assert.equal(placed.design.parts[0].symbol, 'bed');
  const plan = makePlan(), floor = activeFloor(plan);
  const project = createProject();
  const map = makeElement('map', 0, 0);
  const withPlan = insertElement(project, project.root, map, updateFloor(plan, { ...floor, objects: [bed, placed] }));
  const { project: reopened } = await decodeProject(await encodeProject(withPlan));
  assert.deepEqual(activeFloor(reopened.boards[map.boardId].plan).objects, [bed, placed]);
});
