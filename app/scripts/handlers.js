import {
  addDaysKey,
  canTrendsNext,
  canTrendsPrev,
  cycleForMode,
  entryFor,
  findCycleByDate,
  getCurrentCycle,
  getUpcomingCycle,
  hasAnyEntries,
  habitById,
  pushCycle,
  pushEntry,
  putEntry,
  render,
  showToast,
  state,
  todayKey,
  uid,
  viewDayKey,
} from './core.js';
import { bootSync } from './sync.js';

export function setupHandlers() {
  document.body.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  const id = t.dataset.id;
  const delta = parseInt(t.dataset.delta || '0', 10);

  if (action === 'habit-add-backdrop') {
    if (e.target.closest('.plan-modal-alert')) return;
    state.addHabitDraft = null;
    document.body.style.overflow = '';
    render();
    return;
  }

  if (action === 'retry-sync') {
    bootSync();
    return;
  }
  if (!state.cloudReady) return;
  if (action === 'tab') {
    state.tab = t.dataset.tab;
    if (state.tab !== 'plan') state.addHabitDraft = null;
    render();
    return;
  }
  if (action === 'trends-mode') {
    const m = t.dataset.mode;
    if (m === 'cycle' || m === 'month' || m === 'year' || m === 'all') {
      state.trendsMode = m;
      state.trendsStep = 0;
      render();
    }
    return;
  }
  if (action === 'trends-prev') {
    if (canTrendsPrev()) { state.trendsStep -= 1; render(); }
    return;
  }
  if (action === 'trends-next') {
    if (canTrendsNext()) { state.trendsStep += 1; render(); }
    return;
  }
  if (action === 'day-prev') {
    const dk = viewDayKey();
    const n = addDaysKey(dk, -1);
    const lo = state.cycles[0] ? state.cycles[0].startDate : todayKey();
    if (n >= lo) { state.viewDate = n; render(); }
    return;
  }
  if (action === 'day-next') {
    const n = addDaysKey(viewDayKey(), 1);
    if (n <= todayKey()) { state.viewDate = n; render(); }
    return;
  }
  if (action === 'day-today') { state.viewDate = todayKey(); render(); return; }
  if (action === 'plan-mode') {
    if (!hasAnyEntries()) { state.planMode = 'current'; render(); return; }
    state.planMode = t.dataset.mode;
    render();
    return;
  }
  if (action === 'habit-add-cancel') { state.addHabitDraft = null; document.body.style.overflow = ''; render(); return; }
  if (action === 'habit-add-kind') {
    const d = state.addHabitDraft;
    if (!d) return;
    const k = t.getAttribute('data-kind');
    if (k !== 'boolean' && k !== 'count') return;
    d.kind = k;
    render();
    return;
  }
  if (action === 'habit-add-ok') {
    const d = state.addHabitDraft;
    if (!d) return;
    const inp = document.getElementById('plan-new-habit-input');
    const label = inp && inp.value.trim();
    if (!label) {
      showToast('Enter a name');
      return;
    }
    const kind = d.kind === 'count' ? 'count' : 'boolean';
    const cPlan = cycleForMode();
    if (!Array.isArray(cPlan.habitDefinitions)) cPlan.habitDefinitions = [];
    cPlan.habitDefinitions.push({
      id: uid('habit'),
      categoryId: d.categoryId,
      label,
      kind,
      scoring: kind === 'count' ? { pointsPerUnit: 1, maxUnits: 4 } : { points: 1 },
    });
    state.addHabitDraft = null;
    document.body.style.overflow = '';
    pushCycle(cPlan.id);
    render();
    return;
  }
  const curCycle = findCycleByDate(viewDayKey()) || getCurrentCycle();
  const entryHabit = habitById(curCycle, id);
  if (action === 'toggle-habit' && entryHabit && entryHabit.kind === 'boolean') {
    const dk = viewDayKey();
    const entry = entryFor(dk);
    entry.habitValuesById[id] = !entry.habitValuesById[id];
    putEntry(dk, entry);
    pushEntry(dk);
    render();
    return;
  }
  if (action === 'counter-habit' && entryHabit && entryHabit.kind === 'count') {
    const dk = viewDayKey();
    const entry = entryFor(dk);
    const cur = Number(entry.habitValuesById[id] || 0);
    entry.habitValuesById[id] = Math.max(0, Math.min(cur + delta, entryHabit.scoring.maxUnits || 0));
    putEntry(dk, entry);
    pushEntry(dk);
    render();
    return;
  }

  const cycle = cycleForMode();
  if (action === 'cycle-len') {
    cycle.lengthDays = Math.max(7, cycle.lengthDays + delta);
    cycle.endDate = addDaysKey(cycle.startDate, cycle.lengthDays - 1);
    pushCycle(cycle.id);
    if (state.planMode === 'current') {
      const n = getUpcomingCycle();
      n.startDate = addDaysKey(cycle.endDate, 1);
      n.endDate = addDaysKey(n.startDate, n.lengthDays - 1);
      pushCycle(n.id);
    }
    render();
    return;
  }
  if (action === 'add-category') {
    const label = prompt('New category name');
    if (!label) return;
    const up = label.trim().toUpperCase();
    if (cycle.categories.some(c => c.label === up)) { showToast('Category exists'); return; }
    cycle.categories.push({ id: uid('cat'), label: up, sortOrder: cycle.categories.length + 1, accent: '#d4a574' });
    pushCycle(cycle.id);
    render();
    return;
  }
  if (action === 'rename-category') {
    const c = cycle.categories.find(x => x.id === id);
    if (!c) return;
    const next = prompt('Category name', c.label);
    if (!next) return;
    c.label = next.trim().toUpperCase();
    pushCycle(cycle.id);
    render();
    return;
  }
  if (action === 'remove-category') {
    if (cycle.habitDefinitions.some(h => h.categoryId === id)) { showToast('Remove habits first'); return; }
    cycle.categories = cycle.categories.filter(c => c.id !== id);
    pushCycle(cycle.id);
    render();
    return;
  }
  if (action === 'add-habit') {
    state.addHabitDraft = { categoryId: id, kind: 'boolean' };
    render();
    const inp = document.getElementById('plan-new-habit-input');
    if (inp) {
      inp.focus();
      try { inp.select(); } catch (_) {}
    }
    return;
  }
  if (action === 'remove-habit') {
    cycle.habitDefinitions = cycle.habitDefinitions.filter(h => h.id !== id);
    pushCycle(cycle.id);
    render();
    return;
  }
  if (action === 'rename-habit') {
    const h = cycle.habitDefinitions.find(x => x.id === id);
    if (!h) return;
    const next = prompt('Habit label', h.label);
    if (!next) return;
    h.label = next.trim();
    pushCycle(cycle.id);
    render();
    return;
  }
  if (action === 'switch-kind') {
    const h = cycle.habitDefinitions.find(x => x.id === id);
    if (!h) return;
    if (h.kind === 'boolean') {
      h.kind = 'count';
      h.scoring = { pointsPerUnit: Math.max(1, h.scoring.points || 1), maxUnits: 4 };
    } else {
      h.kind = 'boolean';
      h.scoring = { points: Math.max(1, h.scoring.pointsPerUnit || 1) };
    }
    pushCycle(cycle.id);
    render();
    return;
  }
  if (action === 'score-edit') {
    const h = cycle.habitDefinitions.find(x => x.id === id);
    if (!h) return;
    const f = t.dataset.field;
    if (h.kind === 'boolean' && f === 'points') h.scoring.points = Math.max(0, (h.scoring.points || 0) + delta);
    if (h.kind === 'count' && f === 'pointsPerUnit') h.scoring.pointsPerUnit = Math.max(0, (h.scoring.pointsPerUnit || 0) + delta);
    if (h.kind === 'count' && f === 'maxUnits') h.scoring.maxUnits = Math.max(0, (h.scoring.maxUnits || 0) + delta);
    pushCycle(cycle.id);
    render();
    return;
  }
  });
}
