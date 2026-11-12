import { $, button, element, task } from './common.js';
import { ACCENT, FONTS, LABEL, LISTS, SHAPES, STACK_LAYOUTS, WORKSPACES, clamp, id, layerId } from './model.js';

export const SHAPE_NAMES = { rectangle: 'Rectangle', rounded: 'Rounded rectangle', ellipse: 'Circle / ellipse', line: 'Line', arrow: 'Arrow' };
const LIST_NAMES = { bullets: 'Bulleted', numbers: 'Numbered', checklist: 'Checklist' };

function field(label, input) {
  const wrapper = element('label', 'plot-field');
  wrapper.append(element('span', null, label), input);
  return wrapper;
}
function input(label, type, value, action, attributes = {}) {
  const control = element('input');
  control.type = type;
  Object.assign(control, attributes);
  if (type === 'checkbox') control.checked = value;
  else control.value = value;
  control.onchange = () => action(type === 'checkbox' ? control.checked : type === 'number' ? control.valueAsNumber : control.value, control);
  return field(label, control);
}
function options(values, current, names) {
  const control = element('select');
  for (const value of values) {
    const option = element('option', null, names?.[value] ?? value);
    option.value = value;
    control.append(option);
  }
  control.value = current;
  return control;
}
function select(label, values, current, action, names) {
  const control = options(values, current, names);
  control.onchange = () => action(control.value);
  return field(label, control);
}
function actions(...entries) {
  const group = element('div', 'inspector-actions');
  for (const [name, action] of entries) group.append(button(name, task(action)));
  return group;
}
function number(label, value, min, max, action, step = 1) {
  return input(label, 'number', value, (next, control) => {
    next = Number.isFinite(next) ? clamp(next, min, max) : value;
    control.value = next;
    action(next);
  }, { min, max, step });
}
function textToolbar(editor, model, editing) {
  const toolbar = element('div', 'rich-tools');
  for (const [symbol, command, label] of [['B', 'bold', 'Bold'], ['I', 'italic', 'Italic'], ['U', 'underline', 'Underline'], ['S', 'strikeThrough', 'Strikethrough']]) {
    const tool = button(symbol, () => editor.format(model.id, command));
    tool.setAttribute('aria-label', label);
    tool.title = label;
    tool.style.fontWeight = command === 'bold' ? 'bold' : '';
    tool.style.fontStyle = command === 'italic' ? 'italic' : '';
    tool.style.textDecoration = command === 'underline' ? 'underline' : command === 'strikeThrough' ? 'line-through' : '';
    tool.onmousedown = event => event.preventDefault();
    toolbar.append(tool);
  }
  const block = options(['p', 'h1', 'h2', 'h3', 'blockquote'], 'p', { p: 'Paragraph', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', blockquote: 'Quote' });
  block.setAttribute('aria-label', 'Paragraph style');
  block.onchange = () => editor.format(model.id, 'formatBlock', block.value);
  toolbar.append(block);
  return [
    actions([editing ? 'Finish Editing' : 'Edit Text', () => editing ? editor.endEditing() : editor.edit(model.id)]),
    toolbar,
    select('Font', FONTS, model.font, font => editor.patch(model.id, { font })),
    number('Font size', model.size, 8, 120, size => editor.patch(model.id, { size })),
    select('Alignment', ['left', 'center', 'right', 'justify'], model.align, align => editor.patch(model.id, { align })),
    input('Text color', 'color', model.color ?? '#322921', color => editor.patch(model.id, { color })),
    input('Selection color', 'color', '#322921', color => editor.format(model.id, 'foreColor', color)),
    input('Highlight selection', 'color', '#eedba2', color => editor.format(model.id, 'hiliteColor', color)),
  ];
}

function listFields(editor, model) {
  const list = element('div', 'list-editor');
  for (const [index, item] of model.items.entries()) {
    const row = element('div', 'list-edit-row');
    const text = element('input');
    text.type = 'text';
    text.placeholder = 'List item';
    text.maxLength = 4000;
    text.value = item.text;
    text.setAttribute('aria-label', `Item ${index + 1}`);
    text.oninput = () => editor.editItem(model.id, item.id, text.value);
    text.onfocus = () => editor.beginField();
    text.onblur = () => editor.endField();
    const tools = [
      ['↑', 'Move item up', () => editor.moveItem(model.id, item.id, -1), index === 0],
      ['↓', 'Move item down', () => editor.moveItem(model.id, item.id, 1), index === model.items.length - 1],
      ['×', 'Remove item', () => editor.removeItem(model.id, item.id), false],
    ];
    row.append(text);
    for (const [mark, title, action, disabled] of tools) {
      const control = button(mark, action);
      control.setAttribute('aria-label', title);
      control.title = title;
      control.disabled = disabled;
      row.append(control);
    }
    list.append(row);
  }
  return [
    select('List style', LISTS, model.kind, kind => editor.patch(model.id, { kind }), LIST_NAMES),
    list,
    actions(['Add Item', () => {
      editor.patch(model.id, { items: [...editor.getElement(model.id).items, { id: id(), text: '', done: false }] }, true);
      $('inspector-body').querySelector('.list-edit-row:last-child input')?.focus();
    }]),
  ];
}

export function renderInspector(editor) {
  const { model, count, link, editing } = editor.selection();
  const root = $('inspector-body');
  if (link) {
    const label = link.label ?? { text: '', size: 14, color: '#765213', hidden: false };
    const patchLabel = changes => editor.patchLink({ label: { ...(editor.selection().link?.label ?? label), ...changes } });
    root.replaceChildren(
      element('h2', null, 'Connection'),
      input('Label', 'text', label.text, text => patchLabel({ text }), { maxLength: 500, ariaLabel: 'Connection label' }),
      number('Label size', label.size, 8, 72, size => patchLabel({ size })),
      input('Label color', 'color', label.color, color => patchLabel({ color })),
      input('Show label', 'checkbox', !label.hidden, visible => patchLabel({ hidden: !visible })),
      actions(['Remove Label', () => editor.patchLink({ label: undefined }, true)]),
      input('Line color', 'color', link.color, color => editor.patchLink({ color })),
      select('Line style', ['solid', 'dashed', 'dotted'], link.style, style => editor.patchLink({ style })),
      input('Directional arrow', 'checkbox', link.arrow, arrow => editor.patchLink({ arrow })),
      actions(['Reverse Direction', () => editor.patchLink({ from: link.to, to: link.from }, true)], ['Delete', editor.delete]),
    );
    return;
  }
  if (!model) {
    root.replaceChildren(element('h2', null, count ? `${count} selected` : 'Canvas tools'),
      count ? actions(['Duplicate', editor.duplicate], ['Delete', editor.delete], ['Bring Forward', () => editor.layer(true)], ['Send Backward', () => editor.layer(false)])
        : element('p', null, 'Select an element to edit its style and contents. Shift-click to select several.'),
    );
    return;
  }
  const patch = (changes, refresh) => editor.patch(model.id, changes, refresh);
  const fields = [element('h2', null, LABEL[model.type])];
  if (model.title !== undefined) fields.push(input('Title', 'text', model.title, title => patch({ title: title.trim() || (model.type === 'canvas' ? 'Untitled Canvas' : `Untitled ${LABEL[model.type]}`) }), { maxLength: 160 }));
  if (WORKSPACES.includes(model.type)) fields.push(actions([model.type === 'canvas' ? 'Open Canvas' : `Open ${LABEL[model.type]}`, () => editor.navigate(model.boardId)]));
  const layers = editor.layers();
  if (layers.length > 1) fields.push(select('Layer', layers.filter(layer => !layer.locked && !layer.hidden).map(layer => layer.id),
    layerId(model), value => editor.moveToLayer(model.id, value), Object.fromEntries(layers.map(layer => [layer.id, layer.title]))));
  if (model.type === 'stack') {
    fields.push(select('Layout', STACK_LAYOUTS, model.layout, layout => patch({ layout }, true),
      { collapsed: 'Collapsed', vertical: 'Vertical', horizontal: 'Horizontal', grid: 'Grid' }));
    if (model.layout === 'collapsed') fields.push(actions([model.expanded ? 'Collapse' : 'Expand', () => editor.toggleStack(model.id)]));
  }
  if (model.type === 'reference') fields.push(actions(['Go to Original', () => editor.goTo(model.targetId)]));
  if (model.type === 'marker' || model.type === 'event') {
    fields.push(input('Color', 'color', model.color ?? ACCENT, color => patch({ color })));
    if (model.type === 'event') {
      const description = element('textarea');
      description.value = model.description;
      description.maxLength = 12000;
      description.onchange = () => patch({ description: description.value });
      const chronology = element('input');
      chronology.type = 'number';
      chronology.step = 'any';
      chronology.value = model.chronology ?? '';
      chronology.placeholder = 'Automatic';
      chronology.onchange = () => {
        const value = chronology.valueAsNumber;
        const next = Number.isFinite(value) ? clamp(value, -1e9, 1e9) : null;
        chronology.value = next ?? '';
        patch({ chronology: next });
      };
      fields.push(
        input('Date', 'text', model.date, date => patch({ date: date.trim() }), { maxLength: 160, placeholder: 'YYYY-MM-DD or fictional date' }),
        input('Time', 'text', model.time, time => patch({ time: time.trim() }), { maxLength: 40, placeholder: 'HH:MM' }),
        field('Chronology', chronology),
        number('Duration (hours)', model.duration, 0, 1e7, duration => patch({ duration }), .25),
        field('Description', description),
      );
    }
    fields.push(actions(['Link Element', () => editor.linkElement(model.id)],
      ...(model.targetId ? [['Go to Linked Element', () => editor.goTo(model.targetId)],
        ['Remove Link', () => patch({ targetId: undefined }, true)]] : [])));
  }
  if (model.type === 'text' || model.type === 'note') fields.push(...textToolbar(editor, model, editing));
  if (model.type === 'note') fields.push(input('Show border', 'checkbox', model.border, border => patch({ border })));
  if (model.type === 'list') fields.push(...listFields(editor, model));
  if (['text', 'note', 'list', 'shape', 'canvas'].includes(model.type)) fields.push(
    input('Background / fill', 'color', model.fill ?? ACCENT, fill => patch({ fill })),
    actions(['Clear Fill', () => patch({ fill: undefined }, true)]),
  );
  if (model.type === 'shape') fields.push(
    select('Shape', SHAPES, model.shape, shape => patch({ shape }), SHAPE_NAMES),
    input('Border / line', 'color', model.stroke, stroke => patch({ stroke })),
    number('Thickness', model.weight, 0, 24, weight => patch({ weight })),
    number('Opacity', model.opacity, 0, 1, opacity => patch({ opacity }), .05),
    number('Rotation (°)', model.angle, -360, 360, angle => patch({ angle })),
  );
  if (['image', 'audio', 'video'].includes(model.type)) fields.push(element('p', null, model.name));
  fields.push(
    number('Width', Math.round(model.w), 48, 10_000_000, w => editor.setSize(model.id, 'w', w)),
    number('Height', Math.round(model.h), 32, 10_000_000, h => editor.setSize(model.id, 'h', h)),
    actions(['Duplicate', editor.duplicate], ['Delete', editor.delete], ['Bring Forward', () => editor.layer(true)], ['Send Backward', () => editor.layer(false)]),
  );
  root.replaceChildren(...fields);
}
