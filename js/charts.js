/**
 * charts.js - Chart.js chart management
 */
import { getFiltered } from './state.js';
import { dispatch } from './state.js';
import { getOccurrencesByTerm } from './data.js';
import { tipoColor, fmt } from './utils.js';

const CHART_DEFAULTS = {
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#4B255D',
      titleFont: { family: "'Poppins', 'Inter', sans-serif", size: 12 },
      bodyFont: { family: "'Poppins', 'Inter', sans-serif", size: 11 },
      padding: 10,
      cornerRadius: 10,
      borderColor: 'rgba(255,255,255,.1)',
      borderWidth: 1,
    },
  },
  animation: { duration: 500 },
};

const charts = {};

export function init() {
  if (!window.Chart) { console.warn('Chart.js not loaded'); return; }
  Chart.defaults.font.family = "'Poppins', 'Inter', system-ui, sans-serif";
  Chart.defaults.plugins.legend.display = false;

  _initBairroChart();
  _initTipoChart();
  _initRatingDistChart();
  _initScatterChart();
  _initRecorrenciaChart();
  _initTermosChart();
}

export function updateAll() {
  const filtered = getFiltered();
  _updateBairro(filtered);
  _updateTipo(filtered);
  _updateRatingDist(filtered);
  _updateScatter(filtered);
  _updateRecorrencia(filtered);
  // Termos chart doesn't depend on filter
}

/* ─── 1. Estabelecimentos por bairro ─────────────────────── */
function _initBairroChart() {
  const ctx = document.getElementById('chart-bairro');
  if (!ctx) return;
  charts.bairro = new Chart(ctx, {
    type: 'bar',
    data: { labels: [], datasets: [{ data: [], backgroundColor: '#CB3AA6', borderRadius: 6, hoverBackgroundColor: '#E61D7F' }] },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
      onClick(evt, els) {
        if (!els.length) return;
        const bairro = charts.bairro.data.labels[els[0].index];
        dispatch('SET_FILTER', { bairros: [bairro] });
      },
    },
  });
  _updateBairro(getFiltered());
}

function _updateBairro(filtered) {
  const c = charts.bairro;
  if (!c) return;
  const map = {};
  for (const e of filtered) {
    const b = e.bairro_pesquisa || 'Sem bairro';
    map[b] = (map[b] ?? 0) + 1;
  }
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 12);
  c.data.labels = sorted.map(x => x[0]);
  c.data.datasets[0].data = sorted.map(x => x[1]);
  c.update('active');
}

/* ─── 2. Doughnut tipo ────────────────────────────────────── */
function _initTipoChart() {
  const ctx = document.getElementById('chart-tipo');
  if (!ctx) return;
  charts.tipo = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Especializado em açaí', 'Açaí + outro segmento', 'Outro estabelecimento'],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: ['#CB3AA6', '#A2CC24', '#B08CBC'],
        hoverBackgroundColor: ['#E61D7F', '#C4E040', '#9B7AAA'],
        borderWidth: 2,
        borderColor: '#fff',
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, padding: 10 } },
      },
      cutout: '60%',
      onClick(evt, els) {
        if (!els.length) return;
        const tipo = charts.tipo.data.labels[els[0].index];
        dispatch('SET_FILTER', { tipos: [tipo] });
      },
    },
  });
  _updateTipo(getFiltered());
}

function _updateTipo(filtered) {
  const c = charts.tipo;
  if (!c) return;
  const labels = ['Especializado em açaí', 'Açaí + outro segmento', 'Outro estabelecimento'];
  c.data.datasets[0].data = labels.map(l => filtered.filter(e => e.tipo_estabelecimento === l).length);
  c.update('active');
}

/* ─── 3. Rating distribution ─────────────────────────────── */
function _initRatingDistChart() {
  const ctx = document.getElementById('chart-rating-dist');
  if (!ctx) return;
  charts.ratingDist = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['< 3.0', '3.0–3.9', '4.0–4.4', '4.5–5.0', 'Sem nota'],
      datasets: [{
        data: [0, 0, 0, 0, 0],
        backgroundColor: ['#DC2626', '#D97706', '#A2CC24', '#CB3AA6', '#D1D5DB'],
        borderRadius: 6,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
  _updateRatingDist(getFiltered());
}

function _updateRatingDist(filtered) {
  const c = charts.ratingDist;
  if (!c) return;
  const bins = [0, 0, 0, 0, 0];
  for (const e of filtered) {
    const r = e.review_rating ?? 0;
    if (r === 0) bins[4]++;
    else if (r < 3) bins[0]++;
    else if (r < 4) bins[1]++;
    else if (r < 4.5) bins[2]++;
    else bins[3]++;
  }
  c.data.datasets[0].data = bins;
  c.update('active');
}

/* ─── 4. Scatter: reviews vs rating ──────────────────────── */
function _initScatterChart() {
  const ctx = document.getElementById('chart-scatter');
  if (!ctx) return;
  charts.scatter = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: [] },
    options: {
      ...CHART_DEFAULTS,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: 'Nº de Avaliações', font: { size: 11 } }, grid: { color: '#f0f0f0' } },
        y: { title: { display: true, text: 'Nota Média', font: { size: 11 } }, min: 0, max: 5, grid: { color: '#f0f0f0' } },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: { display: false },
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.raw.name}: ⭐${ctx.raw.y} (${fmt(ctx.raw.x)} aval.)`,
          },
        },
      },
    },
  });
  _updateScatter(getFiltered());
}

function _updateScatter(filtered) {
  const c = charts.scatter;
  if (!c) return;
  const tipos = ['Especializado em açaí', 'Açaí + outro segmento', 'Outro estabelecimento'];
  c.data.datasets = tipos.map(t => ({
    label: t,
    data: filtered
      .filter(e => e.tipo_estabelecimento === t && e.review_count > 0 && e.review_rating > 0)
      .map(e => ({ x: e.review_count, y: e.review_rating, name: e.nome_estabelecimento })),
    backgroundColor: tipoColor(t) + 'BB',
    pointRadius: 4,
    pointHoverRadius: 7,
  }));
  c.options.plugins.legend = { display: true, labels: { font: { size: 11 }, padding: 8, boxWidth: 12 } };
  c.update('active');
}

/* ─── 5. Recorrência faixas ───────────────────────────────── */
function _initRecorrenciaChart() {
  const ctx = document.getElementById('chart-recorrencia');
  if (!ctx) return;
  charts.recorr = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['1×', '2–3×', '4–5×', '6–10×', '>10×'],
      datasets: [{ data: [0, 0, 0, 0, 0], backgroundColor: '#CB3AA6', borderRadius: 6, hoverBackgroundColor: '#4B255D' }],
    },
    options: {
      ...CHART_DEFAULTS,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
  _updateRecorrencia(getFiltered());
}

function _updateRecorrencia(filtered) {
  const c = charts.recorr;
  if (!c) return;
  const bins = [0, 0, 0, 0, 0];
  for (const e of filtered) {
    const n = e.ocorrencias_total ?? 0;
    if (n <= 1) bins[0]++;
    else if (n <= 3) bins[1]++;
    else if (n <= 5) bins[2]++;
    else if (n <= 10) bins[3]++;
    else bins[4]++;
  }
  c.data.datasets[0].data = bins;
  c.update('active');
}

/* ─── 6. Results by termo ─────────────────────────────────── */
function _initTermosChart() {
  const ctx = document.getElementById('chart-termos');
  if (!ctx) return;
  const data = getOccurrencesByTerm().slice(0, 12);
  charts.termos = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.termo),
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: '#A2CC24',
        borderRadius: 4,
        hoverBackgroundColor: '#C4E040',
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}
