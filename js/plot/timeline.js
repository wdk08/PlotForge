const DAY = 86_400_000;
const HOUR = 3_600_000;
const epoch = Date.UTC(2000, 0, 1);
const dayWidth = .25;
export const TIMELINE_ORIGIN = 70;
const lanes = { calendar: 74, clock: 380, relative: 686 };
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = value => String(value).padStart(2, '0');

export const DATE_ORDERS = { mdy: 'Month / day / year', dmy: 'Day / month / year', ymd: 'Year / month / day' };
export const DATE_SEPARATORS = { '/': 'Slash (/)', '-': 'Dash (−)', '.': 'Dot (.)', ' ': 'Space' };
export const MONTH_FORMATS = { numeric: 'Numeric', short: 'Abbreviated name', long: 'Full name' };
export const TIMELINE_DEFAULTS = { scale: 1, order: 'ymd', separator: '-', month: 'numeric', clock: '24', dateZero: true, hourZero: true, seconds: false };
export const timelineSettings = board => ({ ...TIMELINE_DEFAULTS, ...board?.timeline });

export function parseDate(raw, order = 'ymd') {
  const text = raw.trim();
  if (!text) return '';
  let y, m, d;
  const iso = /^(\d{4})([-/. ])(\d{1,2})\2(\d{1,2})$/.exec(text);
  const numeric = /^(\d{1,2})([-/. ])(\d{1,2})\2(\d{4})$/.exec(text);
  const named = /^(?:([a-z]+)[\s./-]+(\d{1,2})|(\d{1,2})[\s./-]+([a-z]+)),?[\s./-]+(\d{4})$/i.exec(text);
  const namedYear = /^(\d{4})[\s./-]+([a-z]+)[\s./-]+(\d{1,2})$/i.exec(text);
  if (iso) [, y, , m, d] = iso;
  else if (numeric) {
    y = numeric[4];
    [m, d] = order === 'dmy' ? [numeric[3], numeric[1]] : [numeric[1], numeric[3]];
  } else if (named || namedYear) {
    const word = (named ? named[1] ?? named[4] : namedYear[2]).toLowerCase();
    m = months.findIndex(month => [month.toLowerCase(), month.slice(0, 3).toLowerCase()].includes(word)) + 1;
    y = named ? named[5] : namedYear[1];
    d = named ? named[2] ?? named[3] : namedYear[3];
  } else return null;
  if (+y < 1 || +m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  const canonical = `${y}-${pad(m)}-${pad(d)}`;
  const date = new Date(`${canonical}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === canonical ? canonical : null;
}

export function parseTime(raw) {
  const text = raw.trim();
  if (!text) return '';
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text);
  if (!match) return null;
  const [, h, m, s, meridiem] = match;
  if (+m > 59 || +(s ?? 0) > 59 || (meridiem ? +h < 1 || +h > 12 : +h > 23)) return null;
  const hour = meridiem ? +h % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0) : +h;
  return `${pad(hour)}:${m}${s === undefined ? '' : ':' + s}`;
}

export function formatDate(value, settings) {
  const canonical = parseDate(value);
  if (!canonical) return value;
  const [year, month, day] = canonical.split('-');
  const name = months[+month - 1];
  const values = { y: year, m: settings.month === 'numeric' ? (settings.dateZero ? month : +month) :
    settings.month === 'short' ? name.slice(0, 3) : name, d: settings.dateZero ? day : +day };
  if (settings.month !== 'numeric' && settings.separator === ' ' && settings.order === 'mdy') return `${values.m} ${values.d}, ${values.y}`;
  return [...settings.order].map(part => values[part]).join(settings.separator);
}

export function formatTime(value, settings) {
  const canonical = parseTime(value);
  if (!canonical) return value;
  const [hour, minute, second = '00'] = canonical.split(':');
  const twelve = settings.clock === '12', h = twelve ? +hour % 12 || 12 : +hour;
  return `${settings.hourZero ? pad(h) : h}:${minute}${settings.seconds ? ':' + second : ''}${twelve ? (+hour >= 12 ? ' PM' : ' AM') : ''}`;
}

export function eventMode(event) {
  if (event.dateMode) return event.dateMode;
  return [event.date, event.endDate ?? ''].some(value => value && !parseDate(value)) ||
    [event.time, event.endTime ?? ''].some(value => value && !parseTime(value)) ? 'fictional' : 'calendar';
}
const timeMilliseconds = value => {
  const [h, m, s = 0] = value.split(':').map(Number);
  return h * HOUR + m * 60_000 + s * 1000;
};
function calendarPoint(date, time) {
  const actualDate = parseDate(date), actualTime = parseTime(time);
  if (actualDate) return { lane: 'calendar', value: Date.parse(`${actualDate}T00:00:00Z`) + (actualTime ? timeMilliseconds(actualTime) : 0) };
  if (!date && actualTime) return { lane: 'clock', value: timeMilliseconds(actualTime) };
  return null;
}
export function eventPoint(event) {
  const fictional = eventMode(event) === 'fictional';
  if (event.chronology != null && (fictional || !event.dateMode)) return { lane: 'relative', value: event.chronology };
  // Legacy calendar dates with a fictional time already sorted at midnight.
  if (fictional && event.dateMode) return null;
  return calendarPoint(event.date, event.time) ?? calendarPoint(event.endDate ?? '', event.endTime ?? '');
}
export function endBeforeStart(event) {
  if (eventMode(event) !== 'calendar') return false;
  const start = calendarPoint(event.date, event.time);
  const end = calendarPoint(event.endDate ?? '', event.endTime ?? '');
  return Boolean(start && end && start.lane === end.lane && end.value < start.value);
}
export function eventSchedule(event, settings, resolve = value => value) {
  const calendar = eventMode(event) === 'calendar';
  const label = (date, time) => [date && (calendar ? formatDate(date, settings) : resolve(date)),
    time && (calendar ? formatTime(time, settings) : resolve(time))].filter(Boolean).join(' · ');
  const start = label(event.date, event.time), end = label(event.endDate, event.endTime);
  const details = [start, end].filter(Boolean).join(' → ');
  return details || (event.chronology == null ? 'Undated' : `Position ${event.chronology}`);
}

const axisOffset = {
  calendar: value => (value - epoch) / DAY * dayWidth,
  clock: value => value / HOUR * 60,
};
export function timelinePositions(elements, settings) {
  const positioned = new Map(), undated = [], relative = [];
  const place = (model, x, lane) => {
    const axis = lane && lanes[lane];
    positioned.set(model.id, { ...model, x: axis ? x - model.w / 2 : x,
      y: (axis || 286) + (model.timelineOffset ?? (axis ? 24 : 0)), ...(axis && { axisX: x, axisY: axis, axisLane: lane }) });
  };
  for (const model of elements) {
    if (model.type !== 'event') continue;
    const point = eventPoint(model);
    if (!point) undated.push(model);
    else if (point.lane === 'relative') relative.push({ model, value: point.value });
    else place(model, TIMELINE_ORIGIN + axisOffset[point.lane](point.value) * settings.scale, point.lane);
  }
  relative.sort((a, b) => a.value - b.value || a.model.x - b.model.x);
  let rank = -1, previous;
  for (const { model, value } of relative) {
    if (value !== previous) rank++;
    place(model, TIMELINE_ORIGIN + rank * 246 * settings.scale, 'relative');
    previous = value;
  }
  let x = TIMELINE_ORIGIN;
  for (const model of undated.sort((a, b) => a.x - b.x)) {
    place(model, x);
    x += Math.max(246, model.w + 24);
  }
  return positioned;
}

const tickIntervals = [1_000, 5_000, 15_000, 30_000, 60_000, 300_000, 900_000, 1_800_000, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY];
const tickTime = value => new Date(value).toISOString().slice(11, 19);
function calendarTicks(start, end, interval, settings) {
  const ticks = [];
  if (interval <= 14 * DAY) {
    const step = tickIntervals.find(candidate => candidate >= interval) ?? 14 * DAY;
    for (let value = Math.ceil(start / step) * step; value <= end; value += step) {
      const date = new Date(value).toISOString().slice(0, 10);
      ticks.push({ value, label: step >= DAY ? formatDate(date, settings) :
        `${formatDate(date, settings)} ${formatTime(tickTime(value), { ...settings, seconds: settings.seconds || step < 60_000 })}` });
    }
    return ticks;
  }
  const step = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000].find(n => n * 30.4375 * DAY >= interval) ?? 12000;
  const first = new Date(start);
  let month = Math.floor((first.getUTCFullYear() * 12 + first.getUTCMonth()) / step) * step;
  while (true) {
    const date = new Date(0);
    date.setUTCFullYear(Math.floor(month / 12), month % 12, 1);
    const value = +date;
    if (value > end) break;
    if (value >= start && date.getUTCFullYear() >= 1) ticks.push({ value, label: step >= 12 ? String(date.getUTCFullYear()) :
      formatDate(date.toISOString().slice(0, 10), settings) });
    month += step;
  }
  return ticks;
}

export function timelineAxes(elements, settings, left, right, zoom) {
  const existing = new Map();
  for (const item of elements) {
    if (!item.axisLane) continue;
    if (!existing.has(item.axisLane)) existing.set(item.axisLane, []);
    existing.get(item.axisLane).push(item);
  }
  if (!existing.size) existing.set('calendar', []);
  return [...existing].map(([lane, items]) => {
    let ticks = [];
    if (lane === 'relative') {
      let previous = -Infinity;
      for (const item of [...items].sort((a, b) => a.axisX - b.axisX)) {
        if (item.axisX < left || item.axisX > right || (item.axisX - previous) * zoom < 100) continue;
        ticks.push({ x: item.axisX, label: String(item.chronology) });
        previous = item.axisX;
      }
    } else {
      const rate = (lane === 'calendar' ? dayWidth / DAY : 60 / HOUR) * settings.scale;
      const origin = lane === 'calendar' ? epoch : 0;
      const min = lane === 'calendar' ? Date.parse('0001-01-01T00:00:00Z') : 0;
      const max = lane === 'calendar' ? Date.parse('9999-12-31T23:59:59Z') : DAY - 1;
      const start = Math.max(min, origin + (left - TIMELINE_ORIGIN) / rate);
      const end = Math.min(max, origin + (right - TIMELINE_ORIGIN) / rate);
      const interval = 150 / (rate * zoom);
      if (end >= start) {
        if (lane === 'calendar') ticks = calendarTicks(start, end, interval, settings);
        else {
          const step = tickIntervals.find(candidate => candidate >= interval) ?? DAY;
          for (let value = Math.ceil(start / step) * step; value <= end; value += step) {
            ticks.push({ value, label: formatTime(tickTime(value), { ...settings, seconds: settings.seconds || step < 60_000 }) });
          }
        }
        ticks = ticks.map(({ value, label }) => ({ x: TIMELINE_ORIGIN + (value - origin) * rate, label }));
      }
    }
    return { y: lanes[lane], lane, ticks, items };
  });
}
