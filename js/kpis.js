/**
 * kpis.js - KPI hierárquico: 1 principal + secundários; modo contextual na seleção
 */
import { getGlobalStats, getByPlaceId, countQueriesFor, getCollectionDate } from './data.js';
import { state, dispatch, getFiltered, activeFilterCount } from './state.js';
import { fmt, fmtDist, countUp, esc, tipoKey, TIPOS, icon, reducedMotion } from './utils.js';

let _mode = null;

export function render() {
  const grid = document.getElementById('kpi-grid');
  if (!grid) return;
  const sel = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;
  const model = sel ? _selectedModel(sel) : _globalModel();
  const mode = sel ? `sel:${sel.place_id}` : 'global';

  if (_mode === mode) { _update(grid, model); return; }

  const first = _mode === null;
  _mode = mode;
  if (first || reducedMotion()) { _build(grid, model); return; }
  grid.classList.add('is-swapping');
  setTimeout(() => { _build(grid, model); grid.classList.remove('is-swapping'); }, 180);
}

/* ── Models ────────────────────────────────────── */
function _globalModel() {
  const g = getGlobalStats();
  const f = getFiltered();
  const isF = activeFilterCount() > 0;
  const ids = new Set(f.map(e => e.place_id));
  const rated = f.filter(e => e.review_rating > 0);
  const avg = rated.length ? rated.reduce((s, e) => s + e.review_rating, 0) / rated.length : null;
  const reviews = f.reduce((s, e) => s + (e.review_count ?? 0), 0);
  const occ = f.reduce((s, e) => s + (e.ocorrencias_total ?? 0), 0);
  const q = isF ? countQueriesFor(ids) : g.queries;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const date = getCollectionDate();

  return {
    primary: {
      eyebrow: 'Estabelecimentos encontrados',
      value: f.length,
      delta: isF
        ? `<span class="kpi-pill">${pct(f.length, g.total)}% do total</span> de ${fmt(g.total)} mapeados`
        : `em ${fmt(g.bairros)} bairros${date ? ` · coleta de ${date}` : ''}`,
      tipos: TIPOS.map(t => ({ t, c: f.filter(e => e.tipo_estabelecimento === t).length })),
      total: f.length,
    },
    cards: [
      { id: 'rating', ic: 'star', label: 'Avaliação média', value: avg, dec: 2,
        desc: avg ? `${fmt(rated.length)} com nota` : 'sem notas nos filtros',
        delta: isF && avg ? _diff(avg - g.avgRating, 2, 'vs. geral') : null },
      { id: 'reviews', ic: 'chat', label: 'Avaliações acumuladas', value: reviews,
        desc: 'no Google Maps',
        delta: isF ? `${pct(reviews, g.totalRatings)}% do total` : null },
      { id: 'bairros', ic: 'grid', label: 'Bairros pesquisados', value: new Set(f.map(e => e.bairro_pesquisa)).size,
        desc: 'com ao menos um ponto', delta: isF ? `de ${fmt(g.bairros)}` : null },
      { id: 'queries', ic: 'search', label: 'Consultas realizadas', value: q,
        desc: isF ? 'com estes pontos' : 'bairro × termo', delta: isF ? `de ${fmt(g.queries)}` : null },
      { id: 'occ', ic: 'repeat', label: 'Ocorrências', value: occ,
        desc: 'aparições nos resultados', delta: isF ? `${pct(occ, g.occurrencesTotal)}% do total` : null },
    ],
  };
}

function _selectedModel(e) {
  const k = tipoKey(e.tipo_estabelecimento);
  const hasR = e.review_rating > 0;
  return {
    primary: {
      eyebrow: 'Estabelecimento selecionado',
      name: e.nome_estabelecimento,
      meta: `<i class="lg-dot t-${k}"></i>${esc(e.tipo_estabelecimento)} · ${esc(e.bairro_pesquisa ?? '')} · ${fmtDist(e.distancia_bairro_pesquisa_km)} do bairro`,
    },
    cards: [
      { id: 's-rating', ic: 'star', label: 'Avaliação', value: hasR ? e.review_rating : null, dec: 1,
        desc: hasR ? 'nota no Google' : 'sem avaliações' },
      { id: 's-reviews', ic: 'chat', label: 'Avaliações', value: e.review_count ?? 0, desc: 'no Google Maps' },
      { id: 's-recorr', ic: 'repeat', label: 'Recorrência', value: e.ocorrencias_total ?? 0, desc: 'consultas' },
      { id: 's-500', ic: 'radius', label: 'Em 500 m', value: e.estabelecimentos_500m ?? 0, desc: 'pontos próximos' },
      { id: 's-1k', ic: 'radius', label: 'Em 1 km', value: e.estabelecimentos_1km ?? 0, desc: 'pontos próximos' },
    ],
  };
}

function _diff(d, dec, suffix) {
  const s = d > 0 ? '+' : d < 0 ? '−' : '±';
  return `${s}${fmt(Math.abs(d), dec)} ${suffix}`;
}

/* ── DOM ───────────────────────────────────────── */
function _build(grid, m) {
  const p = m.primary;
  grid.innerHTML = `
    <article class="kpi-primary${p.name ? ' is-selected' : ''}">
      ${p.name ? `<div class="kpi-eyebrow">${icon('target', 14)} ${p.eyebrow}</div>` : ''}
      ${p.name ? `
        <div class="kpi-sel-name">${esc(p.name)}</div>
        <div class="kpi-sel-meta">${p.meta}</div>
        <button class="kpi-sel-clear" type="button">${icon('close', 12)} Limpar seleção</button>
      ` : `
        <div class="kpi-hero-num" id="kpi-main-val">0</div>
        <div class="kpi-hero-label">Estabelecimentos<br>encontrados</div>
        <div class="kpi-delta" id="kpi-main-delta">${p.delta}</div>
        <div class="kpi-typebar" id="kpi-typebar" role="group" aria-label="Distribuição por tipo">${_typebar(p)}</div>
      `}
    </article>
    <div class="kpi-secondary">
      ${m.cards.map(c => `
        <article class="kpi-card" id="kpi-${c.id}">
          <div class="kpi-card-top">
            <span class="kpi-ic">${icon(c.ic, 15)}</span>
            <span class="kpi-label">${c.label}</span>
          </div>
          <div class="kpi-value" id="kpi-${c.id}-val">${c.text ? esc(c.text) : (c.value == null ? '—' : '0')}</div>
          <div class="kpi-desc" id="kpi-${c.id}-desc">${c.desc}</div>
          <div class="kpi-card-delta" id="kpi-${c.id}-delta">${c.delta ?? ''}</div>
        </article>`).join('')}
    </div>`;

  grid.setAttribute('aria-busy', 'false');
  grid.querySelector('.kpi-sel-clear')?.addEventListener('click', () => dispatch('SELECT_ESTABLISHMENT', { placeId: null }));
  _bindTypebar(grid);
  _update(grid, m);
}

function _update(grid, m) {
  const p = m.primary;
  if (!reducedMotion()) {
    grid.querySelectorAll('.kpi-hero-num, .kpi-value').forEach(el => {
      el.classList.remove('is-updating'); void el.offsetWidth; el.classList.add('is-updating');
    });
  }
  const main = document.getElementById('kpi-main-val');
  if (main) countUp(main, p.value, 450, 0);
  const d = document.getElementById('kpi-main-delta');
  if (d && !p.name) d.innerHTML = p.delta;
  const tb = document.getElementById('kpi-typebar');
  if (tb && p.tipos) { tb.innerHTML = _typebar(p); _bindTypebar(grid); }

  for (const c of m.cards) {
    const v = document.getElementById(`kpi-${c.id}-val`);
    if (!v) continue;
    if (c.text) v.textContent = c.text;
    else if (c.value == null) { v.textContent = '—'; v.dataset.current = ''; }
    else countUp(v, c.value, 450, c.dec ?? 0);
    const de = document.getElementById(`kpi-${c.id}-desc`);
    if (de) de.textContent = c.desc;
    const dl = document.getElementById(`kpi-${c.id}-delta`);
    if (dl) dl.textContent = c.delta ?? '';
  }
}

function _typebar(p) {
  const tot = p.total || 1;
  const active = state.filters.tipos;
  return `
    <div class="kpi-typebar-track">
      ${p.tipos.map(({ t, c }) => c ? `<span class="t-${tipoKey(t)}" style="flex:${c}" title="${esc(t)}: ${fmt(c)}"></span>` : '').join('')}
    </div>
    <div class="kpi-typelegend">
      ${p.tipos.map(({ t, c }) => `
        <button type="button" data-tipo="${esc(t)}" class="${active.includes(t) ? 'is-active' : ''}" aria-pressed="${active.includes(t)}">
          <i class="lg-dot t-${tipoKey(t)}"></i><span>${esc(t)}</span><strong>${fmt(c)}</strong><em>${Math.round(c / tot * 100)}%</em>
        </button>`).join('')}
    </div>`;
}

function _bindTypebar(grid) {
  grid.querySelectorAll('.kpi-typelegend [data-tipo]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.tipo;
    const cur = state.filters.tipos;
    dispatch('SET_FILTER', { tipos: cur.length === 1 && cur[0] === t ? [] : [t] });
  }));
}
