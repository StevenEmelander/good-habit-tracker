import {
  cycleForMode,
  escapeHtml,
  hasAnyCheckins,
  state,
  totalMax,
} from './core.js';

function tuneCatAccent(cat) {
  const a = String((cat && cat.accent) || '#d4a574').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(a) ? a : '#d4a574';
}

function habitKindLabel(kind) {
  return kind === 'count' ? 'CNT' : 'Y/N';
}

export function renderAddHabitModal() {
  const d = state.addHabitDraft;
  if (!d) return '';
  const kindSel = d.kind || 'boolean';
  const kb = kindSel === 'boolean';
  const kc = kindSel === 'count';
  return `<div class="tune-modal-backdrop" data-action="habit-add-backdrop" role="presentation">
    <div class="tune-modal-alert" role="dialog" aria-modal="true" aria-labelledby="tune-modal-title">
      <div id="tune-modal-title" class="tune-modal-alert-title">New habit</div>
      <p class="tune-modal-alert-hint">Name + type.</p>
      <input id="tune-new-habit-input" class="tune-input-inmodal" type="text" placeholder="Name" maxlength="120" autocomplete="off" autocapitalize="sentences" />
      <div class="tune-modal-kind-row">
        <button type="button" class="btn ${kb ? 'primary' : ''}" data-action="habit-add-kind" data-kind="boolean">Yes / no</button>
        <button type="button" class="btn ${kc ? 'primary' : ''}" data-action="habit-add-kind" data-kind="count">Count</button>
      </div>
      <div class="tune-modal-alert-actions">
        <button type="button" class="btn" data-action="habit-add-cancel">Cancel</button>
        <button type="button" class="btn primary" data-action="habit-add-ok">OK</button>
      </div>
    </div>
  </div>`;
}

export function renderTune() {
  const hasCheckins = hasAnyCheckins();
  if (!hasCheckins) state.tuneMode = 'current';
  const c = cycleForMode();
  const categories = (c.categories || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  const cycleHead = hasCheckins && state.tuneMode === 'next' ? 'Upcoming cycle' : 'Current cycle';
  return `<div class="tune-root">
    <div class="tune-h">Plan</div>
    ${hasCheckins ? `<div class="tune-seg">
      <button type="button" class="btn ${state.tuneMode === 'current' ? 'primary' : ''}" data-action="tune-mode" data-mode="current">Now</button>
      <button type="button" class="btn ${state.tuneMode === 'next' ? 'plan' : ''}" data-action="tune-mode" data-mode="next">Next</button>
    </div>` : ''}
    <div class="card tune-cycle-card">
      <div class="mono muted" style="font-size:10px;letter-spacing:0.07em;margin-bottom:6px">${cycleHead.toUpperCase()}</div>
      <div class="row between" style="flex-wrap:wrap;gap:10px;align-items:flex-start">
        <div style="min-width:0">
          <div style="font-size:20px;font-weight:700;line-height:1.12">${totalMax(c)}<span class="muted" style="font-size:13px;font-weight:500"> max/day</span></div>
          <div class="tune-cycle-dates">${c.startDate} → ${c.endDate}</div>
        </div>
        <div class="col" style="gap:4px;align-items:flex-end;min-width:fit-content">
          <div class="row" style="gap:5px"><button type="button" class="btn" data-action="cycle-len" data-delta="-7">−7d</button><button type="button" class="btn" data-action="cycle-len" data-delta="7">+7d</button></div>
          <span class="mono muted" style="font-size:11px">${c.lengthDays} days</span>
        </div>
      </div>
    </div>
    <div class="card tune-cat-toolbar">
      <div class="tune-cat-toolbar-inner">
        <span class="tune-cat-toolbar-lbl">Categories</span>
        <button type="button" class="btn primary" data-action="add-category">+ Category</button>
      </div>
    </div>
    ${categories.map(cat => renderTuneCategory(c, cat)).join('')}
  </div>`;
}

function renderTuneCategory(c, cat) {
  const habits = (c.habitDefinitions || []).filter(h => h.categoryId === cat.id);
  return `<div class="card tune-cat" style="--cat-accent:${tuneCatAccent(cat)}">
    <div class="tune-cat-head">
      <div class="tune-cat-title">${escapeHtml(cat.label)}</div>
      <div class="tune-btns">
        <button type="button" class="btn" data-action="rename-category" data-id="${cat.id}" aria-label="Rename category">Name</button>
        <button type="button" class="btn" data-action="add-habit" data-id="${cat.id}" aria-label="Add habit">+ Habit</button>
        <button type="button" class="btn danger" data-action="remove-category" data-id="${cat.id}" aria-label="Delete category">Remove</button>
      </div>
    </div>
    <div class="col tune-cat-habits">${habits.map(h => renderTuneHabit(h)).join('')}</div>
  </div>`;
}

function renderTuneHabit(h) {
  const ptsOn = h.scoring.points || 0;
  const ppu = h.scoring.pointsPerUnit || 0;
  const cap = h.scoring.maxUnits || 0;
  const scoreBtns = h.kind === 'boolean'
    ? `<div class="tune-scores">
        <div class="tune-score-group">
          <div class="tune-lbl">Points:</div>
          <div class="row tune-stepper">
            <button type="button" class="btn" data-action="score-edit" data-id="${h.id}" data-field="points" data-delta="-1">−</button>
            <div class="mono tune-stepper-val">${ptsOn}</div>
            <button type="button" class="btn" data-action="score-edit" data-id="${h.id}" data-field="points" data-delta="1">+</button>
          </div>
        </div>
      </div>`
    : `<div class="tune-scores">
        <div class="tune-score-group">
          <div class="tune-lbl">Points:</div>
          <div class="row tune-stepper">
            <button type="button" class="btn" data-action="score-edit" data-id="${h.id}" data-field="pointsPerUnit" data-delta="-1">−</button>
            <div class="mono tune-stepper-val">${ppu}</div>
            <button type="button" class="btn" data-action="score-edit" data-id="${h.id}" data-field="pointsPerUnit" data-delta="1">+</button>
          </div>
        </div>
        <div class="tune-score-group tune-score-group-max">
          <div class="tune-lbl">Max:</div>
          <div class="row tune-stepper">
            <button type="button" class="btn" data-action="score-edit" data-id="${h.id}" data-field="maxUnits" data-delta="-1">−</button>
            <div class="mono tune-stepper-val">${cap}</div>
            <button type="button" class="btn" data-action="score-edit" data-id="${h.id}" data-field="maxUnits" data-delta="1">+</button>
          </div>
        </div>
      </div>`;
  return `<div class="card2 tune-habit">
    <div class="tune-habit-top">
      <div class="tune-habit-name">${escapeHtml(h.label)}</div>
      <div class="tune-btns tune-btns-single">
        <button type="button" class="btn" data-action="rename-habit" data-id="${h.id}" aria-label="Rename habit">✎</button>
        <button type="button" class="btn tune-kind" data-action="switch-kind" data-id="${h.id}" title="Switch type">${habitKindLabel(h.kind)}</button>
        <button type="button" class="btn danger" data-action="remove-habit" data-id="${h.id}" aria-label="Delete habit">✕</button>
      </div>
    </div>
    ${scoreBtns}
  </div>`;
}
