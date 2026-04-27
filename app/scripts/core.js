import { renderToday } from './today-ui.js';
import { renderTrends } from './trends-ui.js';
import { renderTune, renderAddHabitModal } from './tune-ui.js';

export const SYNC_URL = '/api/sync';

export const state = {
  checkinsByDate: {},
  cycles: [],
  tab: 'today',
  tuneMode: 'current',
  /** YYYY-MM-DD for the Today tab; never after calendar today. */
  viewDate: null,
  _lastModified: 0,
  cloudReady: false,
  /** Dates touched since last successful POST (partial sync). */
  _dirtyCheckinDates: {},
  _deletedCheckinDates: [],
  /** Inclusive range of dates currently merged from the server. */
  _loadedRange: null,
  /** Server-reported bounds of stored check-ins (may be null until data exists). */
  checkinBounds: null,
  /** Trends tab: cycle / month / year / all-time (not rolling “last N days”). */
  trendsMode: 'cycle',
  /** 0 = period containing today for cycle/month/year; ignored for all. */
  trendsStep: 0,
  /** TUNE: new habit alert — { categoryId, kind?: 'boolean'|'count' }. */
  addHabitDraft: null,
};

export function hasAnyCheckins() {
  return Object.keys(state.checkinsByDate || {}).length > 0;
}

let syncStatus = 'idle';
let toastTimer = null;
let schedulePushImpl = () => {};

export function registerSchedulePush(fn) {
  schedulePushImpl = typeof fn === 'function' ? fn : () => {};
}

export function setSyncStatus(next) {
  syncStatus = next;
}

export function clone(x) { return JSON.parse(JSON.stringify(x)); }
export function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4); }
export function fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function todayKey() { return fmtDate(new Date()); }

/** Sort cycles, return first cycle’s start (or today if none). */
export function firstCycleStartKey() {
  sortCycles();
  const c = state.cycles[0];
  return c ? c.startDate : todayKey();
}

/** Active calendar day for Today tab: clamped to [min(first start, today), today]. */
export function viewDayKey() {
  const t = todayKey();
  const lo = firstCycleStartKey();
  const minD = lo <= t ? lo : t;
  if (!state.viewDate) state.viewDate = t;
  if (state.viewDate > t) state.viewDate = t;
  if (state.viewDate < minD) state.viewDate = minD;
  return state.viewDate;
}

export function addDaysKey(k, n) { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); }
export function rangeFullyLoaded(from, to) {
  const r = state._loadedRange;
  return !!(r && from >= r.from && to <= r.to);
}

function trendsDataExtentMin() {
  const t = todayKey();
  return state.checkinBounds?.min || firstCycleStartKey() || t;
}

function trendsDataExtentMax() {
  const t = todayKey();
  const mx = state.checkinBounds?.max || t;
  return mx > t ? t : mx;
}

/** Inclusive [lo, hi] for overlap checks (handles inverted min/max before first check-in). */
function trendsDataSpan() {
  let lo = trendsDataExtentMin();
  let hi = trendsDataExtentMax();
  if (lo > hi) {
    const x = lo;
    lo = hi;
    hi = x;
  }
  return { lo, hi };
}

function mondayOfWeekContaining(dateKey) {
  const d = new Date(dateKey + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return fmtDate(d);
}

/** Inclusive date keys from..to. */
export function enumerateDateKeys(from, to) {
  const out = [];
  let k = from;
  while (k <= to) {
    out.push(k);
    k = addDaysKey(k, 1);
  }
  return out;
}

function getTrendsRangeFor(mode, step) {
  const t = todayKey();
  if (mode === 'all') {
    const mn = trendsDataExtentMin();
    const mx = trendsDataExtentMax();
    let from = mn <= mx ? mn : mx;
    let to = mn <= mx ? mx : mn;
    if (to > t) to = t;
    if (from > to) return { from: to, to: to, label: 'ALL TIME' };
    return { from, to, label: 'ALL TIME' };
  }
  if (mode === 'cycle') {
    sortCycles();
    const cur = findCycleByDate(t) || getCurrentCycle();
    const curIdx = Math.max(0, state.cycles.findIndex((c) => c.id === cur.id));
    const target = state.cycles[curIdx + step] || cur;
    const toB = target.endDate > t ? t : target.endDate;
    const cycleNum = state.cycles.findIndex((c) => c.id === target.id) + 1;
    return { from: target.startDate, to: toB, label: `CYCLE ${cycleNum}` };
  }
  if (mode === 'month') {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + step, 1);
    const from = fmtDate(d);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    let toB = fmtDate(last);
    if (toB > t) toB = t;
    const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
    return { from, to: toB, label };
  }
  const y = new Date().getFullYear() + step;
  const from = y + '-01-01';
  let toB = y + '-12-31';
  if (toB > t) toB = t;
  return { from, to: toB, label: String(y) };
}

export function getTrendsRange() {
  return getTrendsRangeFor(state.trendsMode, state.trendsStep);
}

function trendsPeriodOverlapsData(from, to) {
  const { lo, hi } = trendsDataSpan();
  return to >= lo && from <= hi;
}

export function canTrendsPrev() {
  if (state.trendsMode === 'all') return false;
  const { from, to } = getTrendsRangeFor(state.trendsMode, state.trendsStep - 1);
  return trendsPeriodOverlapsData(from, to);
}

export function canTrendsNext() {
  if (state.trendsMode === 'all') return false;
  const t = todayKey();
  const { from, to: toN } = getTrendsRangeFor(state.trendsMode, state.trendsStep + 1);
  if (from > t) return false;
  return trendsPeriodOverlapsData(from, toN);
}

export function ensureTrendsRangeLoaded() {
  const { from, to } = getTrendsRange();
  if (rangeFullyLoaded(from, to)) return Promise.resolve();
  return fetchCheckinsRange(from, to);
}

export function dayLabel(k) { return new Date(k + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(); }
export function escapeHtml(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function markCheckinDirty(dk) {
  state._dirtyCheckinDates[dk] = true;
}

function markCheckinDeleted(dk) {
  delete state._dirtyCheckinDates[dk];
  if (!state._deletedCheckinDates.includes(dk)) state._deletedCheckinDates.push(dk);
}

function mergeLoadedRange(from, to) {
  if (!state._loadedRange) state._loadedRange = { from, to };
  else {
    if (from < state._loadedRange.from) state._loadedRange.from = from;
    if (to > state._loadedRange.to) state._loadedRange.to = to;
  }
}

export async function fetchCheckinsRange(from, to) {
  const url = SYNC_URL + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('range');
  const data = await res.json();
  if (!data || !Array.isArray(data.cycles)) return;
  state.cycles = data.cycles;
  state._lastModified = data._lastModified || state._lastModified;
  Object.assign(state.checkinsByDate, data.checkinsByDate || {});
  if (data.checkinBounds) state.checkinBounds = data.checkinBounds;
  mergeLoadedRange(from, to);
  sortCycles();
}

export function ensureDayLoadedThenRender() {
  const dk = viewDayKey();
  const r = state._loadedRange;
  if (r && dk >= r.from && dk <= r.to) { render(); return; }
  fetchCheckinsRange(dk, dk).then(() => render()).catch(() => { showToast('Could not load day'); render(); });
}

function makeDefaultCycle(startDate) {
  const lengthDays = 14;
  return { id: uid('cycle'), startDate, endDate: addDaysKey(startDate, lengthDays - 1), lengthDays, categories: [], habitDefinitions: [] };
}

function initClean() {
  state.checkinsByDate = {};
  state.cycles = [makeDefaultCycle(todayKey())];
  state.viewDate = todayKey();
  state._dirtyCheckinDates = {};
  state._deletedCheckinDates = [];
  state._loadedRange = null;
  state.checkinBounds = null;
  state.trendsMode = 'cycle';
  state.trendsStep = 0;
  state.addHabitDraft = null;
}

/**
 * If check-ins exist before the first cycle starts, shift all cycles so the
 * first cycle starts on the earliest entered check-in date.
 */
export function normalizeFirstCycleStartFromCheckins() {
  sortCycles();
  if (!state.cycles.length) return;
  const dates = Object.keys(state.checkinsByDate || {});
  if (!dates.length) return;
  const first = state.cycles[0];
  const earliest = dates.reduce((m, d) => (d < m ? d : m), dates[0]);
  if (earliest >= first.startDate) return;
  const msPerDay = 86400000;
  const from = new Date(first.startDate + 'T00:00:00');
  const to = new Date(earliest + 'T00:00:00');
  const deltaDays = Math.round((to - from) / msPerDay);
  if (!deltaDays) return;
  for (const c of state.cycles) {
    c.startDate = addDaysKey(c.startDate, deltaDays);
    c.endDate = addDaysKey(c.endDate, deltaDays);
  }
}

export function stripLegacyRestFromCheckins() {
  for (const k of Object.keys(state.checkinsByDate)) {
    const e = state.checkinsByDate[k];
    if (e && Object.prototype.hasOwnProperty.call(e, 'isRestDay')) delete e.isRestDay;
  }
}

export function sortCycles() { state.cycles.sort((a, b) => a.startDate.localeCompare(b.startDate)); }
export function findCycleByDate(dateKey) { return state.cycles.find(c => c.startDate <= dateKey && dateKey <= c.endDate) || null; }

export function getCurrentCycle() {
  sortCycles();
  let c = findCycleByDate(todayKey());
  if (c) return c;
  const first = state.cycles[0];
  if (!first) { initClean(); return state.cycles[0]; }
  if (todayKey() < first.startDate) return first;
  let last = state.cycles[state.cycles.length - 1];
  while (todayKey() > last.endDate) {
    const s = addDaysKey(last.endDate, 1);
    const next = { id: uid('cycle'), startDate: s, endDate: addDaysKey(s, last.lengthDays - 1), lengthDays: last.lengthDays, categories: clone(last.categories), habitDefinitions: clone(last.habitDefinitions) };
    state.cycles.push(next);
    last = next;
  }
  sortCycles();
  return findCycleByDate(todayKey()) || state.cycles[0];
}

export function getUpcomingCycle() {
  const cur = getCurrentCycle();
  const nextStart = addDaysKey(cur.endDate, 1);
  let next = state.cycles.find(c => c.startDate === nextStart);
  if (!next) {
    next = { id: uid('cycle'), startDate: nextStart, endDate: addDaysKey(nextStart, cur.lengthDays - 1), lengthDays: cur.lengthDays, categories: clone(cur.categories), habitDefinitions: clone(cur.habitDefinitions) };
    state.cycles.push(next);
    sortCycles();
  }
  return next;
}

export function cycleForMode() {
  if (!hasAnyCheckins()) return getCurrentCycle();
  return state.tuneMode === 'next' ? getUpcomingCycle() : getCurrentCycle();
}

export function cycleInfo() {
  const cur = getCurrentCycle();
  const day = Math.max(1, Math.floor((new Date(todayKey() + 'T00:00:00') - new Date(cur.startDate + 'T00:00:00')) / 86400000) + 1);
  return { cycleNum: state.cycles.findIndex(x => x.id === cur.id) + 1, day, length: cur.lengthDays, daysLeft: Math.max(0, cur.lengthDays - day), cur };
}

export function entryFor(dateKey) {
  const raw = state.checkinsByDate[dateKey];
  if (!raw) return { habitValuesById: {} };
  return { habitValuesById: raw.habitValuesById || {} };
}

export function putEntry(dateKey, entry) {
  state.checkinsByDate[dateKey] = entry;
  markCheckinDirty(dateKey);
}

/** If no cycle still defines this habit id, remove its check-in values everywhere. */
export function purgeOrphanHabitData(habitId) {
  for (const c of state.cycles) {
    if ((c.habitDefinitions || []).some(h => h.id === habitId)) return;
  }
  for (const dateKey of Object.keys(state.checkinsByDate)) {
    const raw = state.checkinsByDate[dateKey];
    if (!raw || !raw.habitValuesById) continue;
    if (!Object.prototype.hasOwnProperty.call(raw.habitValuesById, habitId)) continue;
    delete raw.habitValuesById[habitId];
    if (Object.keys(raw.habitValuesById).length === 0) {
      delete state.checkinsByDate[dateKey];
      markCheckinDeleted(dateKey);
    } else {
      markCheckinDirty(dateKey);
    }
  }
}

export function habitsForCategory(cycle, cid) { return (cycle.habitDefinitions || []).filter(h => h.categoryId === cid); }
export function habitById(cycle, id) { return (cycle.habitDefinitions || []).find(h => h.id === id); }
export function habitEarned(h, v) { return h.kind === 'boolean' ? (v ? (h.scoring.points || 0) : 0) : Math.max(0, Math.min(Number(v || 0), h.scoring.maxUnits || 0)) * (h.scoring.pointsPerUnit || 0); }
export function habitMax(h) { return h.kind === 'boolean' ? (h.scoring.points || 0) : (h.scoring.maxUnits || 0) * (h.scoring.pointsPerUnit || 0); }
export function categoryPoints(entry, cycle, cid) { if (!entry) return 0; return habitsForCategory(cycle, cid).reduce((s, h) => s + habitEarned(h, (entry.habitValuesById || {})[h.id]), 0); }
export function categoryMax(cycle, cid) { return habitsForCategory(cycle, cid).reduce((s, h) => s + habitMax(h), 0); }
export function totalPoints(entry, cycle) { return (cycle.categories || []).reduce((s, c) => s + categoryPoints(entry, cycle, c.id), 0); }
export function totalMax(cycle) { return (cycle.categories || []).reduce((s, c) => s + categoryMax(cycle, c.id), 0); }

export function save() {
  state._lastModified = Date.now();
  schedulePushImpl();
}

export function load() {
  initClean();
}

export function render() {
  if (!state.cloudReady) {
    document.body.style.overflow = '';
    document.getElementById('app').innerHTML = `
      <div class="shell">
        <div class="card">
          <div class="mono muted">GOOD HABIT TRACKER</div>
          <div style="margin-top:10px; font-size:16px">Connecting to cloud data…</div>
          <div class="muted" style="margin-top:8px; font-size:13px">This app is cloud-first and does not use local storage.</div>
        </div>
      </div>`;
    return;
  }
  const info = cycleInfo();
  const syncPill = syncStatus === 'error'
    ? '<div class="pill mono" style="border-color:var(--danger);color:var(--danger)">SYNC FAILED</div>'
    : syncStatus === 'syncing'
      ? '<div class="pill mono">SYNCING…</div>'
      : '';
  document.getElementById('app').innerHTML = `
    <div class="shell">
      <div class="row between" style="gap:10px;align-items:center;flex-wrap:nowrap;margin-bottom:10px">
        <div class="title" style="margin:0;font-size:22px;line-height:1.1">Good Habit Tracker</div>
        <div class="row" style="margin-left:auto;gap:8px;align-items:center;justify-content:flex-end">
          <div class="mono muted" style="font-size:11px;white-space:nowrap;text-align:right">CYCLE ${info.cycleNum} · DAY ${info.day}/${info.length}</div>
          ${syncPill}
        </div>
      </div>
      ${state.tab === 'today' ? renderToday() : state.tab === 'trends' ? renderTrends() : renderTune()}
    </div>
    <nav class="tabs">
      <button class="tab ${state.tab === 'today' ? 'active' : ''}" data-action="tab" data-tab="today">ENTRIES</button>
      <button class="tab ${state.tab === 'trends' ? 'active' : ''}" data-action="tab" data-tab="trends">TRENDS</button>
      <button class="tab ${state.tab === 'tune' ? 'active' : ''}" data-action="tab" data-tab="tune">TUNE</button>
    </nav>
    ${state.addHabitDraft ? renderAddHabitModal() : ''}`;
  document.body.style.overflow = state.addHabitDraft ? 'hidden' : '';
}

