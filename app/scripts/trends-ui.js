import {
  canTrendsNext,
  canTrendsPrev,
  cycleInfo,
  entryFor,
  enumerateDateKeys,
  escapeHtml,
  findCycleByDate,
  getTrendsRange,
  state,
  totalMax,
  totalPoints,
} from './core.js';

function buildLineChart(data, avg, dayMax) {
  const w = 360, h = 120, p = 4;
  const max = Math.max(dayMax, 1, ...data.map(d => d.pts));
  const dx = data.length > 1 ? (w - p * 2) / (data.length - 1) : 0;
  const y = (v) => p + (h - p * 2) * (1 - (v / max));
  const pts = data.map((d, i) => ({ x: p + i * dx, y: y(d.pts) }));
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <line x1="${p}" y1="${y(avg).toFixed(1)}" x2="${w - p}" y2="${y(avg).toFixed(1)}" stroke="#4a4a55" stroke-dasharray="2 4"/>
    ${pts.length ? `<path d="M${pts.map(q => q.x.toFixed(1) + ',' + q.y.toFixed(1)).join(' L')}" fill="none" stroke="#d4a574" stroke-width="2"></path>` : ''}
    ${pts.map(q => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="2" fill="#d4a574"></circle>`).join('')}
  </svg>`;
}

/** At most maxPts samples for SVG (mean per bucket when downsampling). */
function trendsChartSeries(days, ptsFor, maxPts) {
  const cap = maxPts || 120;
  if (days.length <= cap) return days.map((d) => ({ date: d, pts: ptsFor(d) }));
  const bucket = Math.ceil(days.length / cap);
  const out = [];
  for (let i = 0; i < days.length; i += bucket) {
    const slice = days.slice(i, i + bucket);
    const avgB = slice.reduce((s, d) => s + ptsFor(d), 0) / slice.length;
    out.push({ date: slice[0], pts: avgB });
  }
  return out;
}

export function renderTrends() {
  const info = cycleInfo();
  const ptsFor = (d) => totalPoints(entryFor(d), findCycleByDate(d) || info.cur);
  const maxFor = (d) => totalMax(findCycleByDate(d) || info.cur);
  const pctFor = (d) => {
    const mx = maxFor(d);
    if (!mx) return 0;
    return (ptsFor(d) / mx) * 100;
  };
  const { from, to, label } = getTrendsRange();
  const days = enumerateDateKeys(from, to);
  const numDays = days.length || 1;
  let sumPts = 0, sumMax = 0;
  for (const d of days) {
    sumPts += ptsFor(d);
    sumMax += maxFor(d);
  }
  const avgPerDay = sumPts / numDays;
  const avgPctPerDay = sumMax ? (sumPts / sumMax) * 100 : 0;
  const refMax = days.length ? Math.max(...days.map((d) => maxFor(d)), 1) : 1;
  const chartDataPts = trendsChartSeries(days, ptsFor, 120);
  const chartDataPct = trendsChartSeries(days, pctFor, 120);
  const mode = state.trendsMode;
  const prevOk = canTrendsPrev();
  const nextOk = canTrendsNext();
  const metricsBlock = `<div class="grid-metrics">
      <div class="card"><div class="mono muted">POINTS</div><div class="stat" style="font-size:24px">${sumPts}</div><div class="mono muted">/ ${sumMax}</div></div>
      <div class="card"><div class="mono muted">AVG / DAY</div><div class="stat" style="font-size:24px">${avgPerDay.toFixed(1)}</div><div class="mono muted">pts</div></div>
    </div>`;
  const chartsBlock = `<div class="card">
        <div class="row between" style="margin-bottom:8px;gap:8px;align-items:baseline">
          <div class="mono muted">TOTAL POINTS (${days.length}D)</div>
          <div class="mono muted" style="font-size:11px">avg ${avgPerDay.toFixed(1)} pts/day</div>
        </div>
        ${buildLineChart(chartDataPts, avgPerDay, refMax)}
      </div>
      <div class="card">
        <div class="row between" style="margin-bottom:8px;gap:8px;align-items:baseline">
          <div class="mono muted">PERCENT OF MAX (${days.length}D)</div>
          <div class="mono muted" style="font-size:11px">avg ${avgPctPerDay.toFixed(1)}%</div>
        </div>
        ${buildLineChart(chartDataPct, avgPctPerDay, 100)}
      </div>`;
  return `
    <div class="row" style="margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <button class="btn ${mode === 'cycle' ? 'primary' : ''}" type="button" data-action="trends-mode" data-mode="cycle">CYCLE</button>
      <button class="btn ${mode === 'month' ? 'primary' : ''}" type="button" data-action="trends-mode" data-mode="month">MONTH</button>
      <button class="btn ${mode === 'year' ? 'primary' : ''}" type="button" data-action="trends-mode" data-mode="year">YEAR</button>
      <button class="btn ${mode === 'all' ? 'primary' : ''}" type="button" data-action="trends-mode" data-mode="all">ALL TIME</button>
    </div>
    <div class="card">
      <div class="row between" style="flex-wrap:wrap;gap:8px;align-items:center">
        <button class="btn" type="button" data-action="trends-prev" ${prevOk ? '' : 'disabled'} aria-label="Previous period">←</button>
        <div class="col center" style="flex:1;min-width:0">
          <div class="mono" style="font-size:15px;margin-top:4px;text-align:center">${escapeHtml(label)}</div>
          <div class="muted" style="font-size:12px;margin-top:4px">${from} → ${to}</div>
        </div>
        <button class="btn" type="button" data-action="trends-next" ${nextOk ? '' : 'disabled'} aria-label="Next period">→</button>
      </div>
    </div>
    ${metricsBlock}
    ${chartsBlock}
  `;
}
