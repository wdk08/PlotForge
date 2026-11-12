import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, extractSelection, insertElement, insertSelection, makeElement, validateProject } from '../../js/plot/model.js';
import {
  activeFloor, deleteFloorItems, drawRoom, drawWall, makeFloor, makeOpening, makePlan, openingPosition,
  snapPoint, translateFloorItems, updateFloor,
} from '../../js/plot/floor-model.js';
import { decodeProject, encodeProject } from '../../js/plot/format.js';

test('splitting a room wall joins the new wall, preserves its opening, and keeps the room editable', () => {
  const plan = makePlan();
  const { floor, item: room } = drawRoom(activeFloor(plan), [
    { x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 400 }, { x: 100, y: 400 },
  ]);
  const [wall] = floor.objects;
  const door = makeOpening('door', 'single', { wall: wall.id, at: .75, length: 400 });
  const withDoor = { ...floor, objects: [...floor.objects, door] };
  const split = snapPoint(plan, withDoor, { x: 200, y: 104 }, 12);
  const joined = drawWall(withDoor, { x: 200, y: 0 }, split);
  const items = joined.floor.objects;
  const movedDoor = items.find(item => item.id === door.id);
  const extendedRoom = items.find(item => item.id === room.id);
  assert.equal(extendedRoom.vertices.length, 5);
  assert.ok(extendedRoom.vertices.includes(joined.end.vertex));
  assert.notEqual(movedDoor.wall, wall.id);
  assert.equal(openingPosition(movedDoor, joined.floor).x, 400);
  const translated = translateFloorItems(joined.floor, new Set([movedDoor.wall]), 0, 25);
  assert.equal(openingPosition(movedDoor, translated).y, 125);
  assert.equal(translated.points[joined.end.vertex].y, 125);
  const deleted = deleteFloorItems(translated, new Set([movedDoor.wall]));
  assert.ok(deleted.objects.some(item => item.id === room.id));
  assert.ok(!deleted.objects.some(item => item.id === door.id));
});

test('floor geometry, settings and selection survive a .plf and a copied Map', async () => {
  const project = createProject();
  const map = makeElement('map', 20, 40);
  const plan = makePlan();
  const upper = makeFloor('Upper floor');
  const { floor } = drawRoom(activeFloor(plan), [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 500 }, { x: 0, y: 500 }]);
  const building = updateFloor({ ...plan, floors: [...plan.floors, upper], active: upper.id, style: 'furnished', unit: 'm' }, floor);
  const saved = insertElement(project, project.root, map, building);
  const { project: reopened } = await decodeProject(await encodeProject(saved));
  assert.deepEqual(reopened, saved);

  const fragment = extractSelection(reopened, reopened.root, new Set([map.id]));
  const duplicate = insertSelection(reopened, reopened.root, fragment, 25, 25).project;
  const [, copy] = duplicate.boards[duplicate.root].elements;
  const copiedPlan = duplicate.boards[copy.boardId].plan;
  assert.deepEqual(copiedPlan, building);
  assert.notEqual(copiedPlan, reopened.boards[map.boardId].plan);
  assert.equal(validateProject(duplicate), duplicate);
});
