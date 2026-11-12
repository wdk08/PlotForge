import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeProject, encodeProject } from '../../js/plot/format.js';
import { connect, createProject, extractSelection, insertElement, insertSelection, makeElement, TYPES, validateProject } from '../../js/plot/model.js';
import { placeInStack, presentBoard } from '../../js/plot/planning.js';
import { stackAncestors } from '../../js/plot/stack-tree.js';
import { eventPoint, eventSchedule, formatDate, formatTime, parseDate, parseTime, timelineAxes, timelinePositions, timelineSettings } from '../../js/plot/timeline.js';

test('calendar parsing and formatting preserve real values, midnight and fictional chronology', () => {
  assert.equal(parseDate('2026-02-29'), null);
  assert.equal(parseDate('29/02/2028', 'dmy'), '2028-02-29');
  assert.equal(parseDate('Nov 11, 2026'), '2026-11-11');
  assert.equal(parseDate('11 November 2026'), '2026-11-11');
  assert.equal(parseTime('12:00 AM'), '00:00');
  assert.equal(parseTime('3:30:45 PM'), '15:30:45');
  assert.equal(parseTime('24:30'), null);
  const settings = timelineSettings();
  for (const [order, separator, month, expected] of [
    ['mdy', '/', 'numeric', '11/11/2026'], ['mdy', '-', 'numeric', '11-11-2026'],
    ['mdy', ' ', 'long', 'November 11, 2026'], ['mdy', ' ', 'short', 'Nov 11, 2026'],
    ['dmy', ' ', 'long', '11 November 2026'], ['ymd', '-', 'numeric', '2026-11-11'],
  ]) assert.equal(formatDate('2026-11-11', { ...settings, order, separator, month }), expected);
  assert.equal(formatTime('15:30', { ...settings, clock: '12', hourZero: false }), '3:30 PM');
  assert.equal(formatTime('15:30', { ...settings, clock: '12' }), '03:30 PM');
  assert.equal(formatTime('15:30', { ...settings, seconds: true }), '15:30:00');
  assert.deepEqual(eventPoint(makeElement('event', 0, 0, { time: '15:30' })), { lane: 'clock', value: 55_800_000 });
  const relative = makeElement('event', 0, 0, { date: 'First Moon', time: 'Dusk', chronology: 5 });
  assert.deepEqual(eventPoint(relative), { lane: 'relative', value: 5 });
  assert.equal(eventSchedule(relative, settings), 'First Moon · Dusk');
});

test('timeline geometry uses exact UTC differences at each scale, with independent offsets and adaptive ticks', () => {
  const models = ['2020-01-01', '2020-09-01', '2033-09-01', '2020-09-01'].map((date, i) =>
    makeElement('event', i, 100, { date, timelineOffset: i === 1 ? -180 : 24 }));
  const settings = timelineSettings();
  for (const scale of [.1, .5, 1, 2, 20]) {
    const layout = timelinePositions(models, { ...settings, scale });
    const [a, b, c, same] = [...layout.values()];
    assert.equal(b.axisX, same.axisX);
    assert.equal(b.y, b.axisY - 180);
    for (const [one, two] of [[a, b], [b, c]]) {
      const days = (Date.parse(two.date) - Date.parse(one.date)) / 86_400_000;
      assert.ok(Math.abs(two.axisX - one.axisX - days * .25 * scale) < 1e-8);
    }
  }
  const placed = [...timelinePositions(models, settings).values()];
  const [wide] = timelineAxes(placed, settings, placed[0].axisX, placed[2].axisX, 1);
  const [narrow] = timelineAxes(placed, settings, placed[0].axisX, placed[0].axisX + 40, 6);
  assert.match(wide.ticks[0].label, /^\d{4}$/);
  assert.match(narrow.ticks[0].label, /^\d{4}-\d{2}-\d{2}$/);
});

test('all supported elements survive nested stack layout, copying and portable storage', async () => {
  let project = createProject();
  const root = project.root;
  const outer = makeElement('stack', 10, 20, { layout: 'grid' });
  const inner = makeElement('stack', 20, 20, { stackId: outer.id, layout: 'horizontal' });
  project = insertElement(insertElement(project, root, outer), root, inner);
  let workspace;
  for (const type of TYPES) {
    const model = makeElement(type, 50, 50, { stackId: inner.id,
      ...(type === 'reference' && { targetId: outer.id }) });
    project = insertElement(project, root, model);
    if (type === 'timeline') {
      workspace = model;
      project.boards[model.boardId].timeline = { ...timelineSettings(), scale: 3.5 };
      project = insertElement(project, model.boardId, makeElement('event', 40, 50, {
        date: '2026-11-11', time: '15:30:45', endDate: '2026-11-12', timelineOffset: -225,
      }));
    }
  }
  const outside = makeElement('shape', 680, 500);
  project = insertElement(project, root, outside);
  let board = connect(project.boards[root], workspace.id, outside.id);
  project.boards[root] = board;
  assert.equal(presentBoard(board).elements.length, TYPES.length + 3);
  const closed = { ...board, elements: board.elements.map(model => model.id === outer.id ? { ...model, layout: 'collapsed' } : model) };
  const view = presentBoard(closed);
  assert.deepEqual(view.elements.map(model => model.id), [outer.id, outside.id]);
  assert.equal(view.connections[0].from, outer.id);
  assert.equal(placeInStack(board.elements, new Set([outer.id]), inner, { x: 0, y: 0 }, []), board.elements);
  const bad = structuredClone(project);
  bad.boards[root].elements[0].stackId = inner.id;
  assert.throws(() => validateProject(bad), /cycle/);

  const copy = insertSelection(project, root, extractSelection(project, root, new Set([outer.id])), 30, 30).project;
  const duplicate = copy.boards[root].elements.filter(model => model.type === 'timeline').at(-1);
  assert.notEqual(duplicate.boardId, workspace.boardId);
  assert.equal(stackAncestors(copy.boards[root].elements, duplicate.id).length, 2);
  const { project: reopened } = await decodeProject(await encodeProject(copy));
  assert.equal(reopened.boards[duplicate.boardId].timeline.scale, 3.5);
  assert.equal(reopened.boards[duplicate.boardId].elements[0].timelineOffset, -225);
  assert.equal(reopened.boards[root].connections[0].from, workspace.id);
});

test('deep stacks are validated and projected without recursion', () => {
  const project = createProject();
  const board = project.boards[project.root];
  let stackId;
  for (let index = 0; index < 2500; index++) {
    const model = makeElement('stack', 0, 0, { stackId, layout: 'vertical' });
    board.elements.push(model);
    stackId = model.id;
  }
  assert.equal(validateProject(project), project);
  assert.equal(presentBoard(board).elements.length, 2500);
  assert.equal(extractSelection(project, board.id, new Set([board.elements[0].id])).elements.length, 2500);
});
