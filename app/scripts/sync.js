import {
  addDaysKey,
  load,
  normalizeFirstCycleStartFromCheckins,
  registerSchedulePush,
  render,
  save,
  setSyncStatus,
  sortCycles,
  state,
  stripLegacyRestFromCheckins,
  SYNC_URL,
  todayKey,
} from './core.js';

let pushTimer = null;

export function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    setSyncStatus('syncing');
    try {
      const body = {
        cycles: state.cycles,
        _lastModified: state._lastModified,
        partial: true,
        checkinsByDate: {},
        deletedCheckinDates: [...new Set(state._deletedCheckinDates)],
      };
      for (const k of Object.keys(state._dirtyCheckinDates)) {
        if (state.checkinsByDate[k]) body.checkinsByDate[k] = state.checkinsByDate[k];
      }
      const res = await fetch(SYNC_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setSyncStatus(res.ok ? 'ok' : 'error');
      if (res.ok) {
        state._dirtyCheckinDates = {};
        state._deletedCheckinDates = [];
      }
    } catch (_) { setSyncStatus('error'); }
    render();
  }, 1500);
}

export async function syncFromCloud() {
  try {
    const to = todayKey();
    const from = addDaysKey(to, -730);
    const res = await fetch(
      SYNC_URL + '?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to),
      { credentials: 'same-origin' },
    );
    if (!res.ok) {
      setSyncStatus('error');
      document.body.style.overflow = '';
      document.getElementById('app').innerHTML = `
        <div class="shell">
          <div class="card">
            <div class="mono muted">GOOD HABIT TRACKER</div>
            <div style="margin-top:10px; font-size:16px">Cloud unavailable</div>
            <div class="muted" style="margin-top:8px; font-size:13px">Cannot load data from /api/sync right now.</div>
            <div style="margin-top:10px"><button class="btn primary" data-action="retry-sync">Retry</button></div>
          </div>
        </div>`;
      return;
    }
    const cloud = await res.json();
    if (!cloud) {
      setSyncStatus('ok');
      state.cloudReady = true;
      save();
      render();
      return;
    }
    if (Array.isArray(cloud.cycles)) {
      state.checkinsByDate = cloud.checkinsByDate || {};
      state.cycles = cloud.cycles;
      state._lastModified = cloud._lastModified || 0;
      state.checkinBounds = cloud.checkinBounds || null;
      state._loadedRange = { from, to };
      state._dirtyCheckinDates = {};
      state._deletedCheckinDates = [];
      normalizeFirstCycleStartFromCheckins();
      sortCycles();
      stripLegacyRestFromCheckins();
      render();
    }
    setSyncStatus('ok');
    state.cloudReady = true;
    save();
    render();
  } catch (_) {
    setSyncStatus('error');
    document.body.style.overflow = '';
    document.getElementById('app').innerHTML = `
      <div class="shell">
        <div class="card">
          <div class="mono muted">GOOD HABIT TRACKER</div>
          <div style="margin-top:10px; font-size:16px">Cloud unavailable</div>
          <div class="muted" style="margin-top:8px; font-size:13px">Network error while loading /api/sync.</div>
          <div style="margin-top:10px"><button class="btn primary" data-action="retry-sync">Retry</button></div>
        </div>
      </div>`;
  }
}

export function initSync() {
  registerSchedulePush(schedulePush);
  load();
  render();
  syncFromCloud();
}
