import {
  addDaysKey,
  categoryMax,
  categoryPoints,
  dayLabel,
  entryFor,
  escapeHtml,
  findCycleByDate,
  getCurrentCycle,
  habitsForCategory,
  state,
  todayKey,
  totalMax,
  totalPoints,
  viewDayKey,
} from './core.js';

export function renderEntry() {
  const dk = viewDayKey();
  const t = todayKey();
  const lo = state.cycles[0] ? state.cycles[0].startDate : t;
  const c = findCycleByDate(dk) || getCurrentCycle();
  const e = entryFor(dk);
  const pts = totalPoints(e, c);
  const max = totalMax(c);
  const categories = (c.categories || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const isCurrentDay = dk === t;
  const canNext = addDaysKey(dk, 1) <= t;
  const canPrev = addDaysKey(dk, -1) >= lo;
  const dateLine = isCurrentDay
    ? 'TODAY'
    : new Date(dk + 'T12:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).toUpperCase();
  return `
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px;align-items:center">
        <button class="btn" type="button" data-action="day-prev" ${canPrev ? '' : 'disabled'} aria-label="Previous day">←</button>
        <div class="col center" style="flex:1;min-width:0">
          <div class="mono" style="font-size:14px;margin-top:2px">${dateLine}</div>
        </div>
        <button class="btn" type="button" data-action="day-next" ${canNext ? '' : 'disabled'} aria-label="Next day">→</button>
      </div>
      <div class="row between" style="margin-top:12px"><div class="stat">${pts}</div><div class="mono muted">/ ${max}</div></div>
      <div class="progress" style="margin-top:8px"><div class="fill" style="width:${max ? (pts / max) * 100 : 0}%"></div></div>
    </div>
    ${categories.length === 0 ? `<div class="card"><div class="muted" style="font-size:14px;line-height:1.45">No habits yet. Open <strong>PLAN</strong>, add categories, then add habits and point rules.</div></div>` : categories.map(cat => renderEntryCategory(c, e, cat)).join('')}
  `;
}

function renderEntryCategory(c, e, cat) {
  const habits = habitsForCategory(c, cat.id);
  const accent = cat.accent || '#d4a574';
  return `
    <div class="card">
      <div class="row between"><div class="mono" style="color:${accent}">${escapeHtml(cat.label)}</div><div class="mono muted">${categoryPoints(e, c, cat.id)} / ${categoryMax(c, cat.id)}</div></div>
      <div class="col" style="margin-top:8px">${habits.map(h => renderEntryHabit(h, e, accent)).join('')}</div>
    </div>`;
}

function renderEntryHabit(h, e, accent) {
  const v = (e.habitValuesById || {})[h.id];
  if (h.kind === 'boolean') {
    const on = !!v;
    return `<button class="card2 row between habit" data-action="toggle-habit" data-id="${h.id}"><div>${escapeHtml(h.label)}</div><div class="mono" style="color:${on ? accent : 'var(--muted)'}">${on ? '● +' + (h.scoring.points || 0) : '○ +' + (h.scoring.points || 0)}</div></button>`;
  }
  const n = Number(v || 0), maxUnits = h.scoring.maxUnits || 0, ppu = h.scoring.pointsPerUnit || 0;
  return `<div class="card2">
    <div class="row between"><div>${escapeHtml(h.label)}</div><div class="mono" style="color:${accent}">+${Math.min(n, maxUnits) * ppu} / ${maxUnits * ppu}</div></div>
    <div class="counter"><button class="btn" data-action="counter-habit" data-id="${h.id}" data-delta="-1">−</button><div class="mono center">${n}</div><button class="btn" data-action="counter-habit" data-id="${h.id}" data-delta="1">+</button></div>
  </div>`;
}
