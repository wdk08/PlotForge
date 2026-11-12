import { $, element } from './common.js';
import { DATE_ORDERS, DATE_SEPARATORS, MONTH_FORMATS, endBeforeStart, eventMode, formatDate, formatTime, parseDate, parseTime, timelineSettings } from './timeline.js';

function select(label, choices, value, change) {
  const control = element('select');
  control.setAttribute('aria-label', label);
  for (const [key, name] of Object.entries(choices)) {
    const option = element('option', null, name);
    option.value = key;
    control.append(option);
  }
  control.value = value;
  control.onchange = () => change(control.value);
  return field(label, control);
}
function field(label, control) {
  const wrapper = element('label', 'plot-field');
  wrapper.append(element('span', null, label), control);
  return wrapper;
}

export function scheduleFields(model, board, change) {
  const mode = eventMode(model), values = { ...model }, settings = timelineSettings(board);
  const group = element('div', 'timeline-schedule');
  const help = element('p', null, mode === 'fictional' ? 'Use your own dates and times. Set Chronology to position this event on the relative axis.' :
    `Use YYYY-MM-DD, ${settings.order === 'dmy' ? 'D/M/YYYY' : 'M/D/YYYY'}, or a month name. Times accept 15:30, 3:30 PM, and optional seconds.`);
  const rangeError = element('p', 'timeline-error');
  rangeError.setAttribute('role', 'status');
  const checkRange = () => { rangeError.textContent = endBeforeStart(values) ? 'The end precedes the start. Check both values.' : ''; };
  const manualFields = new Map();
  group.append(select('Date system', { calendar: 'Calendar', fictional: 'Fictional / relative' }, mode, dateMode => {
    const changes = { dateMode };
    if (dateMode === 'fictional') for (const [key, manual] of manualFields) changes[key] = manual.value;
    change(changes, true);
  }), help);

  for (const [heading, prefix] of [['Start', ''], ['End (optional)', 'end']]) {
    const section = element('fieldset', 'timeline-date-fields');
    section.append(element('legend', null, heading));
    for (const type of ['date', 'time']) {
      const label = `${prefix ? 'End' : 'Start'} ${type}`;
      const key = prefix ? prefix + type[0].toUpperCase() + type.slice(1) : type;
      const parse = type === 'date' ? value => parseDate(value, settings.order) : parseTime;
      const manual = element('input');
      manual.type = 'text';
      manual.maxLength = type === 'date' ? 160 : 40;
      manual.value = model[key] ?? '';
      manual.setAttribute('aria-label', label);
      manualFields.set(key, manual);
      const error = element('p', 'timeline-error');
      error.id = `event-${model.id}-${key}-error`;
      error.setAttribute('role', 'status');
      manual.setAttribute('aria-describedby', error.id);
      const picker = element('input');
      picker.type = type;
      if (type === 'time') picker.step = '1';
      picker.setAttribute('aria-label', `${label} picker`);
      const update = () => {
        const value = mode === 'fictional' ? manual.value : parse(manual.value);
        manual.setAttribute('aria-invalid', String(value === null));
        error.textContent = value === null ? (type === 'date' ? 'Enter a valid calendar date or choose Fictional / relative.' :
          'Enter a valid time such as 15:30 or 3:30 PM.') : '';
        picker.value = value ?? '';
        return value;
      };
      const save = value => {
        if (value === null || (values[key] ?? '') === value) return;
        values[key] = value;
        values.dateMode = mode;
        change({ [key]: value, dateMode: mode });
        checkRange();
      };
      manual.oninput = update;
      manual.onchange = () => save(update());
      picker.onchange = () => {
        manual.value = parse(picker.value) ?? '';
        save(update());
      };
      section.append(field(type === 'date' ? 'Date' : 'Time', manual));
      if (mode === 'calendar') section.append(field(type === 'date' ? 'Calendar' : 'Time picker', picker));
      section.append(error);
      if (mode === 'calendar') update();
    }
    group.append(section);
  }
  group.append(rangeError);
  checkRange();
  return group;
}

export function bindTimelineControls(board, change) {
  const slider = $('timeline-scale'), numeric = $('timeline-scale-value'), reset = $('timeline-scale-reset');
  const dialog = $('timeline-format-dialog'), fields = $('timeline-format-fields'), preview = $('timeline-format-preview');
  const sync = settings => {
    slider.value = numeric.value = settings.scale;
    reset.disabled = settings.scale === 1;
  };
  let sliderEdit;
  const scale = (value, grouped) => {
    const settings = timelineSettings(board());
    if (!Number.isFinite(value) || value < .1 || value > 20 || value === settings.scale) { sync(settings); return; }
    change({ ...settings, scale: value }, grouped);
  };
  slider.oninput = () => scale(slider.valueAsNumber, sliderEdit ??= {});
  slider.onchange = () => { scale(slider.valueAsNumber, sliderEdit); sliderEdit = undefined; };
  numeric.onchange = () => scale(numeric.valueAsNumber);
  reset.onclick = () => scale(1);

  $('timeline-format').onclick = () => {
    const boardId = board().id;
    let settings = timelineSettings(board());
    const update = changes => {
      if (board().id !== boardId) return;
      settings = { ...settings, ...changes };
      preview.textContent = `${formatDate('2026-11-11', settings)} · ${formatTime('15:30:45', settings)}`;
    };
    const option = (label, key, choices) => select(label, choices, settings[key], value => update({ [key]: value }));
    const toggle = (label, key) => {
      const control = element('input');
      control.type = 'checkbox';
      control.checked = settings[key];
      control.onchange = () => update({ [key]: control.checked });
      return field(label, control);
    };
    fields.replaceChildren(
      option('Date order', 'order', DATE_ORDERS), option('Date separator', 'separator', DATE_SEPARATORS),
      option('Month display', 'month', MONTH_FORMATS), toggle('Pad numeric month and day', 'dateZero'),
      option('Clock', 'clock', { 12: '12-hour', 24: '24-hour' }), toggle('Pad hour with a zero', 'hourZero'), toggle('Show seconds', 'seconds'),
    );
    update({});
    dialog.returnValue = '';
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'save' && board().id === boardId) change(settings);
    }, { once: true });
    dialog.showModal();
  };
  let active;
  return board => {
    if (board.id !== active) { active = board.id; sliderEdit = undefined; }
    if (board.kind === 'timeline') sync(timelineSettings(board));
  };
}
