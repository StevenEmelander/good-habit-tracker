import {
  API_CYCLES,
  API_ENTRIES,
  applyOrphanSweepLocally,
  load,
  normalizeFirstCycleStartFromEntries,
  registerPushers,
  render,
  setSyncStatus,
  sortCycles,
  state,
} from './core.js';

const CYCLE_DEBOUNCE_MS = 1500;
const ENTRY_DEBOUNCE_MS = 1500;

const cycleTimers = new Map();
const entryTimers = new Map();
let inflight = 0;

function bumpStatus() {
  setSyncStatus(inflight > 0 ? 'syncing' : 'ok');
}

function markError() { setSyncStatus('error'); render(); }

function pushCycleSoon(cycleId) {
  const existing = cycleTimers.get(cycleId);
  if (existing) clearTimeout(existing);
  cycleTimers.set(cycleId, setTimeout(() => flushCycle(cycleId), CYCLE_DEBOUNCE_MS));
}

function pushEntrySoon(dateKey) {
  const existing = entryTimers.get(dateKey);
  if (existing) clearTimeout(existing);
  entryTimers.set(dateKey, setTimeout(() => flushEntry(dateKey), ENTRY_DEBOUNCE_MS));
}

async function flushCycle(cycleId) {
  cycleTimers.delete(cycleId);
  delete state._dirtyCycleIds[cycleId];
  const cycle = state.cycles.find((c) => c.id === cycleId);
  inflight++;
  bumpStatus();
  render();
  try {
    let res;
    if (!cycle) {
      res = await fetch(`${API_CYCLES}/${encodeURIComponent(cycleId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } else {
      res = await fetch(`${API_CYCLES}/${encodeURIComponent(cycleId)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          lengthDays: cycle.lengthDays,
          categories: cycle.categories || [],
          habitDefinitions: cycle.habitDefinitions || [],
        }),
      });
      // Server returns the habit ids it stripped from entries during the orphan sweep.
      // Mirror that locally so the next render hides those values.
      if (res.ok) {
        try {
          const payload = await res.clone().json();
          if (payload && Array.isArray(payload.removedHabitIds) && payload.removedHabitIds.length) {
            applyOrphanSweepLocally(payload.removedHabitIds);
          }
        } catch (_) { /* response had no JSON body — fine */ }
      }
    }
    if (!res.ok) throw new Error('cycle ' + res.status);
  } catch (_) {
    state._dirtyCycleIds[cycleId] = true;
    inflight--;
    markError();
    return;
  }
  inflight--;
  bumpStatus();
  render();
}

async function flushEntry(dateKey) {
  entryTimers.delete(dateKey);
  const entry = state.entriesByDate[dateKey];
  const isDeleted = !entry || Object.keys(entry.habitValuesById || {}).length === 0;
  delete state._dirtyEntryDates[dateKey];
  if (isDeleted) {
    state._deletedEntryDates = state._deletedEntryDates.filter((d) => d !== dateKey);
  }
  inflight++;
  bumpStatus();
  render();
  try {
    let res;
    if (isDeleted) {
      res = await fetch(`${API_ENTRIES}/${encodeURIComponent(dateKey)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      // 404 (already absent) is fine.
      if (!res.ok && res.status !== 404) throw new Error('entry-del ' + res.status);
    } else {
      res = await fetch(`${API_ENTRIES}/${encodeURIComponent(dateKey)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habitValuesById: entry.habitValuesById || {} }),
      });
      if (!res.ok) throw new Error('entry-put ' + res.status);
    }
  } catch (_) {
    if (isDeleted) {
      if (!state._deletedEntryDates.includes(dateKey)) state._deletedEntryDates.push(dateKey);
    } else {
      state._dirtyEntryDates[dateKey] = true;
    }
    inflight--;
    markError();
    return;
  }
  inflight--;
  bumpStatus();
  render();
}

function renderCloudUnavailable(reason) {
  document.body.style.overflow = '';
  document.getElementById('app').innerHTML = `
    <div class="shell">
      <div class="card">
        <div class="mono muted">GOOD HABIT TRACKER</div>
        <div style="margin-top:10px; font-size:16px">Cloud unavailable</div>
        <div class="muted" style="margin-top:8px; font-size:13px">${reason}</div>
        <div style="margin-top:10px"><button class="btn primary" data-action="retry-sync">Retry</button></div>
      </div>
    </div>`;
}

export async function bootSync() {
  setSyncStatus('syncing');
  try {
    const [cyclesRes, entriesRes] = await Promise.all([
      fetch(API_CYCLES, { credentials: 'same-origin' }),
      fetch(API_ENTRIES, { credentials: 'same-origin' }),
    ]);
    if (!cyclesRes.ok || !entriesRes.ok) {
      setSyncStatus('error');
      renderCloudUnavailable('Cannot load data from the server right now.');
      return;
    }
    const cyclesPayload = await cyclesRes.json();
    const entriesPayload = await entriesRes.json();
    const cycles = Array.isArray(cyclesPayload && cyclesPayload.cycles) ? cyclesPayload.cycles : [];
    const entries = (entriesPayload && typeof entriesPayload.entries === 'object' && entriesPayload.entries) || {};
    state.cycles = cycles;
    state.entriesByDate = {};
    for (const dk of Object.keys(entries)) {
      state.entriesByDate[dk] = { habitValuesById: entries[dk] || {} };
    }
    state.entryBounds = (cyclesPayload && cyclesPayload.entryBounds) || null;
    state._dirtyCycleIds = {};
    state._dirtyEntryDates = {};
    state._deletedEntryDates = [];
    sortCycles();
    normalizeFirstCycleStartFromEntries();
    state.cloudReady = true;
    setSyncStatus('ok');
    render();
    // If normalization shifted any cycles, persist them now.
    for (const id of Object.keys(state._dirtyCycleIds)) pushCycleSoon(id);
  } catch (_) {
    setSyncStatus('error');
    renderCloudUnavailable('Network error while loading data.');
  }
}

export function initSync() {
  registerPushers(pushCycleSoon, pushEntrySoon);
  load();
  render();
  bootSync();
}
