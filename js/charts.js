/**
 * charts.js - Chart.js com crossfilter: clique filtra mapa, KPIs, tabela e demais gráficos
 */
import { state, dispatch, getFiltered } from './state.js';
import { getOccurrencesByTerm } from './data.js';
import { tipoColor, fmt, fmtRating, TIPOS, reducedMotion } from './utils.js';

const C = {
  acai: '#7A3C8C', dark: '#4B255D', p2: '#654078', mute: '#E7E2E8',
  lime: '#A2CC24', gray: '#A9A5AD', grid: '#F1ECF3', text: '#737078',
};

const RATING_BINS = [
  { label: '< 3,0',   apply: { ratingMin: null, ratingMax: 3,   noRating: false }, test: r => r !== null && r < 3,              color: '#D9CCE0' },
  { label: '3,0–3,9', apply: { ratingMin: 3,    ratingMax: 4,   noRating: false }, test: r => r !== null && r >= 3 && r < 4,   color: '#B79AC4' },
  { label: '4,0–4,4', apply: { ratingMin: 4,    ratingMax: 4.5, noRating: false }, test: r => r !== null && r >= 4 && r < 4.5, color: '#8E62A0' },
  { label: '4,5–5,0', apply: { ratingMin: 4.5,  ratingMax: null, noRating: false }, test: r => r !== null && r >= 4.5,          color: '#4B255D' },
  { label: 'Sem nota', apply: { ratingMin: null, ratingMax: null, noRating: true }, test: r => r === null,                      color: '#E7E2E8' },
];
const OCC_BINS = [
  { label: '1',    min: 1,  max: 1 },
  { label: '2–3',  min: 2,  max: 3 },
  { label: '4–5',  min: 4,  max: 5 },
  { label: '6–10', min: 6,  max: 10 },
  { label: '11+',  min: 11, max: null },
];

const charts = {};
const rating = e => (e.review_rating > 0 ? e.review_rating : null);

function base(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: reducedMotion() ? 0 : 400, easing: 'easeOutCubic' },
    layout: { padding: 4 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#242126', padding: 10, cornerRadius: 8, displayColors: false,
        titleFont: { family: 'Inter', size: 12, weight: '600' }, bodyFont: { family: 'Inter', size: 12 },
      },
    },
    onHover: (ev, els) => { ev.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    ...extra,
  };
}

const axis = (o = {}) => ({
  grid: { color: C.grid, drawTicks: false },
  border: { display: false },
  ticks: { color: C.text, font: { size: 11 }, padding: 6 },
  ...o,
});

export function init() {
  if (!window.Chart) { console.warn('Chart.js not loaded'); return; }
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = C.text;
  _bairro(); _tipo(); _rating(); _scatter(); _recorr(); _termos();
  updateAll();
}

export function updateAll() {
  _upBairro(); _upTipo(); _upRating(); _upScatter(); _upRecorr(); _upTermos();
}

export function updateSelection() { _upScatter(); }

/* 1 ─ Estabelecimentos por bairro */
function _bairro() {
  const ctx = document.getElementById('chart-bairro');
  if (!ctx) return;
  charts.bairro = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 4, barPercentage: 0.72, categoryPercentage: 0.9 }] },
    options: base({
      indexAxis: 'y',
      scales: { x: axis({ ticks: { color: C.text, font: { size: 11 }, precision: 0 } }), y: axis({ grid: { display: false } }) },
      plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${fmt(c.raw)} estabelecimentos` } } },
      onClick(_, els) {
        if (!els.length) return;
        const b = charts.bairro.data.labels[els[0].index];
        const cur = state.filters.bairros;
        dispatch('SET_FILTER', { bairros: cur.length === 1 && cur[0] === b ? [] : [b] });
      },
    }),
  });
}
function _upBairro() {
  const c = charts.bairro; if (!c) return;
  const m = {};
  for (const e of getFiltered('bairros')) m[e.bairro_pesquisa] = (m[e.bairro_pesquisa] ?? 0) + 1;
  const rows = Object.entries(m).sort((a, b) => b[1] - a[1]);
  const sel = state.filters.bairros;
  c.data.labels = rows.map(r => r[0]);
  c.data.datasets[0].data = rows.map(r => r[1]);
  c.data.datasets[0].backgroundColor = rows.map(r => (!sel.length || sel.includes(r[0]) ? C.acai : C.mute));
  c.update();
}

/* 2 ─ Distribuição por tipo */
const centerText = {
  id: 'centerText',
  afterDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const { ctx, chartArea: a } = chart;
    const total = chart.data.datasets[0].data.reduce((s, v) => s + v, 0);
    const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#242126';
    ctx.font = "700 22px Poppins, Inter, sans-serif";
    ctx.fillText(fmt(total), x, y + 4);
    ctx.fillStyle = C.text;
    ctx.font = "500 10.5px Inter, sans-serif";
    ctx.fillText('estabelecimentos', x, y + 20);
    ctx.restore();
  },
};
function _tipo() {
  const ctx = document.getElementById('chart-tipo');
  if (!ctx) return;
  charts.tipo = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: TIPOS, datasets: [{ data: [0, 0, 0], backgroundColor: [], borderWidth: 2, borderColor: '#fff', hoverOffset: 4 }] },
    options: base({
      cutout: '68%',
      plugins: {
        ...base().plugins,
        legend: { display: true, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 12, font: { size: 11.5 } } },
      },
      onClick(_, els) {
        if (!els.length) return;
        const t = TIPOS[els[0].index];
        const cur = state.filters.tipos;
        dispatch('SET_FILTER', { tipos: cur.length === 1 && cur[0] === t ? [] : [t] });
      },
    }),
    plugins: [centerText],
  });
}
function _upTipo() {
  const c = charts.tipo; if (!c) return;
  const list = getFiltered('tipos');
  const sel = state.filters.tipos;
  c.data.datasets[0].data = TIPOS.map(t => list.filter(e => e.tipo_estabelecimento === t).length);
  c.data.datasets[0].backgroundColor = TIPOS.map(t => (!sel.length || sel.includes(t) ? tipoColor(t) : C.mute));
  c.update();
}

/* 3 ─ Avaliações (faixas de nota) */
function _rating() {
  const ctx = document.getElementById('chart-rating-dist');
  if (!ctx) return;
  charts.rating = new Chart(ctx, {
    type: 'bar',
    data: { labels: RATING_BINS.map(b => b.label), datasets: [{ data: [], backgroundColor: [], borderRadius: 4, barPercentage: 0.7 }] },
    options: base({
      scales: { y: axis({ ticks: { color: C.text, font: { size: 11 }, precision: 0 } }), x: axis({ grid: { display: false } }) },
      onClick(_, els) {
        if (!els.length) return;
        const b = RATING_BINS[els[0].index];
        const cur = _ratingIdx();
        dispatch('SET_FILTER', cur === els[0].index ? { ratingMin: null, ratingMax: null, noRating: false } : b.apply);
      },
    }),
  });
}
function _ratingIdx() {
  const f = state.filters;
  return RATING_BINS.findIndex(b => b.apply.ratingMin === f.ratingMin && b.apply.ratingMax === f.ratingMax && b.apply.noRating === f.noRating);
}
function _upRating() {
  const c = charts.rating; if (!c) return;
  const list = getFiltered('rating');
  const f = state.filters;
  const any = f.ratingMin != null || f.ratingMax != null || f.noRating;
  const idx = _ratingIdx();
  c.data.datasets[0].data = RATING_BINS.map(b => list.filter(e => b.test(rating(e))).length);
  c.data.datasets[0].backgroundColor = RATING_BINS.map((b, i) => (!any || i === idx ? b.color : C.mute));
  c.update();
}

/* 4 ─ Nota × volume de avaliações */
function _scatter() {
  const ctx = document.getElementById('chart-scatter');
  if (!ctx) return;
  charts.scatter = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: [] },
    options: base({
      scales: {
        x: axis({ type: 'logarithmic', title: { display: true, text: 'Nº de avaliações (escala log)', color: C.text, font: { size: 11 } },
          ticks: { color: C.text, font: { size: 11 }, callback: v => ([1, 10, 100, 1000, 10000].includes(v) ? fmt(v) : '') } }),
        y: axis({ min: 1, max: 5, title: { display: true, text: 'Nota média', color: C.text, font: { size: 11 } } }),
      },
      plugins: {
        ...base().plugins,
        legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, boxHeight: 7, padding: 10, font: { size: 11 } } },
        tooltip: { ...base().plugins.tooltip, callbacks: { title: i => i[0].raw.name, label: c => `Nota ${fmtRating(c.raw.y)} · ${fmt(c.raw.x)} avaliações` } },
      },
      onClick(_, els) {
        if (!els.length) return;
        const p = charts.scatter.data.datasets[els[0].datasetIndex].data[els[0].index];
        dispatch('SELECT_ESTABLISHMENT', { placeId: p.id });
      },
    }),
  });
}
function _upScatter() {
  const c = charts.scatter; if (!c) return;
  const list = getFiltered().filter(e => e.review_count > 0 && e.review_rating > 0);
  const sel = state.selectedPlaceId;
  c.data.datasets = TIPOS.map(t => {
    const pts = list.filter(e => e.tipo_estabelecimento === t)
      .map(e => ({ x: e.review_count, y: e.review_rating, name: e.nome_estabelecimento, id: e.place_id }));
    const col = tipoColor(t);
    return {
      label: t,
      data: pts,
      backgroundColor: pts.map(p => (sel && p.id !== sel ? col + '33' : col + 'CC')),
      borderColor: pts.map(p => (p.id === sel ? '#242126' : 'transparent')),
      borderWidth: pts.map(p => (p.id === sel ? 2 : 0)),
      pointRadius: pts.map(p => (p.id === sel ? 7 : 3.5)),
      pointHoverRadius: 6,
    };
  });
  c.update();
}

/* 5 ─ Recorrência nas buscas */
function _recorr() {
  const ctx = document.getElementById('chart-recorrencia');
  if (!ctx) return;
  charts.recorr = new Chart(ctx, {
    type: 'bar',
    data: { labels: OCC_BINS.map(b => b.label), datasets: [{ data: [], backgroundColor: [], borderRadius: 4, barPercentage: 0.7 }] },
    options: base({
      scales: {
        y: axis({ ticks: { color: C.text, font: { size: 11 }, precision: 0 } }),
        x: axis({ grid: { display: false }, title: { display: true, text: 'Ocorrências nas consultas', color: C.text, font: { size: 11 } } }),
      },
      plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${fmt(c.raw)} estabelecimentos` } } },
      onClick(_, els) {
        if (!els.length) return;
        const b = OCC_BINS[els[0].index];
        const f = state.filters;
        dispatch('SET_FILTER', f.ocorrMin === b.min && f.ocorrMax === b.max ? { ocorrMin: null, ocorrMax: null } : { ocorrMin: b.min, ocorrMax: b.max });
      },
    }),
  });
}
function _upRecorr() {
  const c = charts.recorr; if (!c) return;
  const list = getFiltered('ocorr');
  const f = state.filters;
  const any = f.ocorrMin != null || f.ocorrMax != null;
  c.data.datasets[0].data = OCC_BINS.map(b => list.filter(e => {
    const n = e.ocorrencias_total ?? 0;
    return n >= b.min && (b.max == null || n <= b.max);
  }).length);
  c.data.datasets[0].backgroundColor = OCC_BINS.map(b => (!any || (f.ocorrMin === b.min && f.ocorrMax === b.max) ? C.p2 : C.mute));
  c.update();
}

/* 6 ─ Termos de busca */
function _termos() {
  const ctx = document.getElementById('chart-termos');
  if (!ctx) return;
  charts.termos = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderRadius: 4, barPercentage: 0.72 }] },
    options: base({
      indexAxis: 'y',
      scales: { x: axis({ ticks: { color: C.text, font: { size: 11 }, precision: 0 } }), y: axis({ grid: { display: false } }) },
      plugins: { ...base().plugins, tooltip: { ...base().plugins.tooltip, callbacks: { label: c => `${fmt(c.raw)} ocorrências` } } },
      onClick(_, els) {
        if (!els.length) return;
        const t = charts.termos.data.labels[els[0].index];
        const cur = state.filters.termos;
        dispatch('SET_FILTER', { termos: cur.length === 1 && cur[0] === t ? [] : [t] });
      },
    }),
  });
}
function _upTermos() {
  const c = charts.termos; if (!c) return;
  const ids = new Set(getFiltered('termos').map(e => e.place_id));
  const rows = getOccurrencesByTerm(ids).slice(0, 10);
  const sel = state.filters.termos;
  c.data.labels = rows.map(r => r.termo);
  c.data.datasets[0].data = rows.map(r => r.count);
  c.data.datasets[0].backgroundColor = rows.map(r => (!sel.length || sel.includes(r.termo) ? '#8DB51E' : C.mute));
  c.update();
}

export function resize() {
  Object.values(charts).forEach(c => c.resize());
}
