import { renderEntry } from './entry-ui.js';
import { renderTrends } from './trends-ui.js';
import { renderPlan, renderAddHabitModal } from './plan-ui.js';

export const API_CYCLES = '/api/cycles';
export const API_ENTRIES = '/api/entries';

export const state = {
  /** dateKey → { habitValuesById }. Filled at boot from GET /api/entries. */
  entriesByDate: {},
  /** Cycle definitions, sorted by startDate. Filled at boot from GET /api/cycles. */
  cycles: [],
  tab: 'entry',
  planMode: 'current',
  /** YYYY-MM-DD displayed in the entry tab; clamped to [first cycle start, today]. */
  viewDate: null,
  cloudReady: false,
  /** Per-item dirty tracking. cycleId → true; dateKey → true. */
  _dirtyCycleIds: {},
  _dirtyEntryDates: {},
  _deletedEntryDates: [],
  /** Server-reported bounds of stored entries (may be null until data exists). */
  entryBounds: null,
  /** Trends tab: cycle / month / year / all-time (not rolling “last N days”). */
  trendsMode: 'cycle',
  /** 0 = period containing today for cycle/month/year; ignored for all. */
  trendsStep: 0,
  /** Plan: new habit alert — { categoryId, kind?: 'boolean'|'count' }. */
  addHabitDraft: null,
};

export function hasAnyEntries() {
  return Object.keys(state.entriesByDate || {}).length > 0;
}

let syncStatus = 'idle';
let toastTimer = null;
let pushCycleImpl = () => {};
let pushEntryImpl = () => {};

export function registerPushers(pushCycle, pushEntry) {
  pushCycleImpl = typeof pushCycle === 'function' ? pushCycle : () => {};
  pushEntryImpl = typeof pushEntry === 'function' ? pushEntry : () => {};
}

export function setSyncStatus(next) {
  syncStatus = next;
}

export function clone(x) { return JSON.parse(JSON.stringify(x)); }
export function uid(p) { return p + '_' + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-4); }
export function fmtDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export function todayKey() { return fmtDate(new Date()); }

export function firstCycleStartKey() {
  sortCycles();
  const c = state.cycles[0];
  return c ? c.startDate : todayKey();
}

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

function trendsDataExtentMin() {
  const t = todayKey();
  return state.entryBounds?.min || firstCycleStartKey() || t;
}

function trendsDataExtentMax() {
  const t = todayKey();
  const mx = state.entryBounds?.max || t;
  return mx > t ? t : mx;
}

function trendsDataSpan() {
  let lo = trendsDataExtentMin();
  let hi = trendsDataExtentMax();
  if (lo > hi) { const x = lo; lo = hi; hi = x; }
  return { lo, hi };
}

export function enumerateDateKeys(from, to) {
  const out = [];
  let k = from;
  while (k <= to) { out.push(k); k = addDaysKey(k, 1); }
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

export function dayLabel(k) { return new Date(k + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(); }
export function escapeHtml(s) { return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function markEntryDirty(dk) {
  state._dirtyEntryDates[dk] = true;
}

function markEntryDeleted(dk) {
  delete state._dirtyEntryDates[dk];
  if (!state._deletedEntryDates.includes(dk)) state._deletedEntryDates.push(dk);
}

function markCycleDirty(cycleId) {
  state._dirtyCycleIds[cycleId] = true;
}

function makeDefaultCycle(startDate) {
  const lengthDays = 14;
  return { id: uid('cycle'), startDate, endDate: addDaysKey(startDate, lengthDays - 1), lengthDays, categories: [], habitDefinitions: [] };
}

function initClean() {
  state.entriesByDate = {};
  state.cycles = [makeDefaultCycle(todayKey())];
  state.viewDate = todayKey();
  state._dirtyCycleIds = {};
  state._dirtyEntryDates = {};
  state._deletedEntryDates = [];
  state.entryBounds = null;
  state.trendsMode = 'cycle';
  state.trendsStep = 0;
  state.addHabitDraft = null;
}

/**
 * If entries exist before the first cycle starts, shift all cycles so the
 * first cycle starts on the earliest entered date. Marks each shifted cycle
 * dirty so the boot-time normalization persists via per-cycle PUT.
 */
export function normalizeFirstCycleStartFromEntries() {
  sortCycles();
  if (!state.cycles.length) return;
  const dates = Object.keys(state.entriesByDate || {});
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
    markCycleDirty(c.id);
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
    markCycleDirty(next.id);
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
    markCycleDirty(next.id);
  }
  return next;
}

export function cycleForMode() {
  if (!hasAnyEntries()) return getCurrentCycle();
  return state.planMode === 'next' ? getUpcomingCycle() : getCurrentCycle();
}

export function cycleInfo() {
  const cur = getCurrentCycle();
  const day = Math.max(1, Math.floor((new Date(todayKey() + 'T00:00:00') - new Date(cur.startDate + 'T00:00:00')) / 86400000) + 1);
  return { cycleNum: state.cycles.findIndex(x => x.id === cur.id) + 1, day, length: cur.lengthDays, daysLeft: Math.max(0, cur.lengthDays - day), cur };
}

export function entryFor(dateKey) {
  const raw = state.entriesByDate[dateKey];
  if (!raw) return { habitValuesById: {} };
  return { habitValuesById: raw.habitValuesById || {} };
}

export function putEntry(dateKey, entry) {
  state.entriesByDate[dateKey] = entry;
  markEntryDirty(dateKey);
}

/**
 * Mirror the server-side orphan sweep on the local cache so the next render shows
 * the same thing the server has after it sweeps. Called on cycle PUT/DELETE response.
 */
export function applyOrphanSweepLocally(removedHabitIds) {
  if (!removedHabitIds || !removedHabitIds.length) return;
  const ids = new Set(removedHabitIds);
  for (const dateKey of Object.keys(state.entriesByDate)) {
    const raw = state.entriesByDate[dateKey];
    if (!raw || !raw.habitValuesById) continue;
    let changed = false;
    for (const k of Object.keys(raw.habitValuesById)) {
      if (ids.has(k)) { delete raw.habitValuesById[k]; changed = true; }
    }
    if (!changed) continue;
    if (Object.keys(raw.habitValuesById).length === 0) {
      delete state.entriesByDate[dateKey];
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

/** Flush a specific entry edit to the server. */
export function pushEntry(dateKey) {
  if (state.entriesByDate[dateKey] && Object.keys(state.entriesByDate[dateKey].habitValuesById || {}).length === 0) {
    delete state.entriesByDate[dateKey];
    markEntryDeleted(dateKey);
  } else {
    markEntryDirty(dateKey);
  }
  pushEntryImpl(dateKey);
}

/** Flush a specific cycle edit to the server. */
export function pushCycle(cycleId) {
  markCycleDirty(cycleId);
  pushCycleImpl(cycleId);
}

export function load() { initClean(); }

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
      ${state.tab === 'entry' ? renderEntry() : state.tab === 'trends' ? renderTrends() : renderPlan()}
    </div>
    <nav class="tabs">
      <button class="tab ${state.tab === 'entry' ? 'active' : ''}" data-action="tab" data-tab="entry">ENTRIES</button>
      <button class="tab ${state.tab === 'trends' ? 'active' : ''}" data-action="tab" data-tab="trends">TRENDS</button>
      <button class="tab ${state.tab === 'plan' ? 'active' : ''}" data-action="tab" data-tab="plan">PLAN</button>
    </nav>
    ${state.addHabitDraft ? renderAddHabitModal() : ''}`;
  document.body.style.overflow = state.addHabitDraft ? 'hidden' : '';
}
