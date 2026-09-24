/**
 * filters.js - Barra de filtros com painéis flutuantes + chips ativos
 */
import { getBairros, getCategorias } from './data.js';
import { state, dispatch, getFiltered } from './state.js';
import { esc, fmt, fmtDist, normalize, tipoKey, tipoShort, TIPOS, icon } from './utils.js';

const r = e => (e.review_rating > 0 ? e.review_rating : null);

const DEFS = [
  { key: 'bairro', label: 'Bairro', type: 'multi', stateKey: 'bairros', group: 'bairros', field: 'bairro_pesquisa', options: () => getBairros(), search: true },
  { key: 'tipo', label: 'Tipo', type: 'multi', stateKey: 'tipos', group: 'tipos', field: 'tipo_estabelecimento', options: () => TIPOS, dots: true },
  { key: 'categoria', label: 'Categoria', type: 'multi', stateKey: 'categorias', group: 'categorias', field: 'categoria_padronizada', options: () => getCategorias(), search: true },
  {
    key: 'rating', label: 'Avaliação', type: 'single', group: 'rating',
    clear: { ratingMin: null, ratingMax: null, noRating: false },
    current: f => (f.noRating ? 'none' : f.ratingMin != null && f.ratingMax == null ? String(f.ratingMin) : f.ratingMin != null || f.ratingMax != null ? 'custom' : null),
    options: [
      ...[4.5, 4, 3.5, 3].map(v => ({ id: String(v), label: `${fmt(v, 1)} ou mais`, apply: { ratingMin: v, ratingMax: null, noRating: false }, test: e => r(e) !== null && r(e) >= v })),
      { id: 'none', label: 'Sem avaliação', apply: { ratingMin: null, ratingMax: null, noRating: true }, test: e => r(e) === null },
    ],
  },
  {
    key: 'reviews', label: 'Avaliações', type: 'single', group: 'reviews',
    clear: { reviewsMin: null },
    current: f => (f.reviewsMin != null ? String(f.reviewsMin) : null),
    options: [1, 10, 50, 100, 500].map(n => ({ id: String(n), label: n === 1 ? 'Ao menos 1' : `${fmt(n)} ou mais`, apply: { reviewsMin: n }, test: e => (e.review_count ?? 0) >= n })),
  },
  {
    key: 'dist', label: 'Distância', type: 'single', group: 'dist',
    note: 'Distância até o ponto de referência do bairro pesquisado.',
    clear: { distMax: null },
    current: f => (f.distMax != null ? String(f.distMax) : null),
    options: [0.5, 1, 2, 5].map(km => ({ id: String(km), label: `Até ${fmtDist(km)}`, apply: { distMax: km }, test: e => (e.distancia_bairro_pesquisa_km ?? Infinity) <= km })),
  },
];

let pop = null, openKey = null, popQuery = '';

export function render() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Filtros');
  bar.innerHTML = `
    <div class="fb-row">
      <div class="fb-controls" role="toolbar" aria-label="Filtros disponíveis">
        <span class="fb-label">${icon('filter', 14)} Filtrar</span>
        ${DEFS.map(d => `
          <button type="button" class="fb-btn" data-key="${d.key}" aria-haspopup="dialog" aria-expanded="false">
            <span class="fb-k">${d.label}</span><span class="fb-v" hidden></span><span class="fb-badge" hidden></span>${icon('chevron', 12)}
          </button>`).join('')}
      </div>
      <div class="fb-result" aria-live="polite"><strong id="fb-count">0</strong> <span id="fb-count-label">resultados</span></div>
    </div>
    <div class="fb-active" id="fb-active" hidden>
      <span class="fb-active-label">Filtros ativos</span>
      <div id="active-chips" role="list"></div>
      <button type="button" class="fb-clear" id="fb-clear">Limpar tudo</button>
    </div>`;

  bar.querySelectorAll('.fb-btn').forEach(btn => btn.addEventListener('click', ev => {
    ev.stopPropagation();
    openKey === btn.dataset.key ? _close() : _open(btn.dataset.key, btn);
  }));
  document.getElementById('fb-clear').addEventListener('click', () => dispatch('CLEAR_FILTERS'));

  pop = document.createElement('div');
  pop.id = 'filter-pop';
  pop.className = 'fp';
  pop.setAttribute('role', 'dialog');
  pop.hidden = true;
  document.body.appendChild(pop);
  const backdrop = document.createElement('div');
  backdrop.className = 'fp-backdrop';
  backdrop.hidden = true;
  backdrop.addEventListener('click', _close);
  document.body.appendChild(backdrop);

  document.addEventListener('mousedown', ev => {
    if (!openKey) return;
    if (pop.contains(ev.target) || ev.target.closest('.fb-btn')) return;
    _close();
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && openKey) { _close(true); } });
  window.addEventListener('resize', () => openKey && _close());

  update();
}

/** Chamado a cada mudança de filtro */
export function update() {
  const f = state.filters;
  document.querySelectorAll('.fb-btn').forEach(btn => {
    const d = DEFS.find(x => x.key === btn.dataset.key);
    const n = d.type === 'multi' ? f[d.stateKey].length : (d.current(f) ? 1 : 0);
    const badge = btn.querySelector('.fb-badge');
    const val = btn.querySelector('.fb-v');
    let shown = '';
    if (d.type === 'multi' && n === 1) shown = d.key === 'tipo' ? tipoShort(f[d.stateKey][0]) : f[d.stateKey][0];
    else if (d.type === 'single' && n) {
      const cur = d.current(f);
      shown = d.options.find(o => o.id === cur)?.label ?? 'Faixa do gráfico';
    }
    btn.classList.toggle('is-active', n > 0);
    val.hidden = !shown;
    val.textContent = shown;
    badge.hidden = !(d.type === 'multi' && n > 1);
    badge.textContent = n;
  });
  const count = getFiltered().length;
  const cEl = document.getElementById('fb-count');
  if (cEl) cEl.textContent = fmt(count);
  const lEl = document.getElementById('fb-count-label');
  if (lEl) lEl.textContent = count === 1 ? 'resultado' : 'resultados';
  renderChips();
  if (openKey) _paintPop(false);
}

export function renderChips() {
  const wrap = document.getElementById('fb-active');
  const box = document.getElementById('active-chips');
  if (!box) return;
  const f = state.filters;
  const chips = [];
  const add = (k, v, clear) => chips.push({ k, v, clear });

  f.bairros.forEach(b => add('Bairro', b, { bairros: f.bairros.filter(x => x !== b) }));
  f.tipos.forEach(t => add('Tipo', t, { tipos: f.tipos.filter(x => x !== t) }));
  f.categorias.forEach(c => add('Categoria', c, { categorias: f.categorias.filter(x => x !== c) }));
  f.termos.forEach(t => add('Termo', `“${t}”`, { termos: f.termos.filter(x => x !== t) }));
  if (f.noRating) add('Nota', 'Sem avaliação', { noRating: false });
  else if (f.ratingMin != null || f.ratingMax != null) {
    const v = f.ratingMin != null && f.ratingMax != null ? `${fmt(f.ratingMin, 1)}–${fmt(f.ratingMax - 0.1, 1)}`
      : f.ratingMin != null ? `${fmt(f.ratingMin, 1)}+` : `abaixo de ${fmt(f.ratingMax, 1)}`;
    add('Nota', v, { ratingMin: null, ratingMax: null });
  }
  if (f.reviewsMin != null) add('Avaliações', `${fmt(f.reviewsMin)}+`, { reviewsMin: null });
  if (f.distMax != null) add('Distância', `até ${fmtDist(f.distMax)}`, { distMax: null });
  if (f.ocorrMin != null || f.ocorrMax != null) {
    const v = f.ocorrMin === f.ocorrMax ? `${f.ocorrMin}` : f.ocorrMax == null ? `${f.ocorrMin}+` : `${f.ocorrMin}–${f.ocorrMax}`;
    add('Recorrência', `${v} ocorr.`, { ocorrMin: null, ocorrMax: null });
  }
  if (f.search) add('Busca', `“${f.search}”`, { search: '' });

  box.innerHTML = chips.map((c, i) => `
    <span class="filter-chip" role="listitem">
      <span class="chip-k">${esc(c.k)}</span>${esc(c.v)}
      <button type="button" class="remove-chip" data-i="${i}" aria-label="Remover filtro ${esc(c.k)}: ${esc(c.v)}">${icon('close', 10)}</button>
    </span>`).join('');
  box.querySelectorAll('.remove-chip').forEach(b => b.addEventListener('click', () => {
    const c = chips[+b.dataset.i];
    dispatch('SET_FILTER', c.clear);
    if ('search' in c.clear) { const inp = document.getElementById('header-search-input'); if (inp) inp.value = ''; }
  }));
  if (wrap) wrap.hidden = chips.length === 0;
}

/* ── Popover ───────────────────────────────────── */
function _open(key, btn) {
  _close();
  openKey = key;
  popQuery = '';
  btn.setAttribute('aria-expanded', 'true');
  _paintPop(true);
  pop.hidden = false;
  document.querySelector('.fp-backdrop').hidden = window.innerWidth > 640;
  _position(btn);
  requestAnimationFrame(() => pop.classList.add('is-open'));
  (pop.querySelector('.fp-search') || pop.querySelector('input'))?.focus({ preventScroll: true });
}

function _close(returnFocus = false) {
  if (!openKey) return;
  const btn = document.querySelector(`.fb-btn[data-key="${openKey}"]`);
  btn?.setAttribute('aria-expanded', 'false');
  openKey = null;
  pop.classList.remove('is-open');
  pop.hidden = true;
  document.querySelector('.fp-backdrop').hidden = true;
  if (returnFocus) btn?.focus();
}

function _position(btn) {
  if (window.innerWidth <= 640) { pop.style.left = ''; pop.style.top = ''; return; }
  const rc = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 280;
  pop.style.left = `${Math.max(12, Math.min(rc.left, window.innerWidth - w - 12))}px`;
  pop.style.top = `${rc.bottom + 8}px`;
}

function _paintPop(full) {
  const d = DEFS.find(x => x.key === openKey);
  if (!d) return;
  const f = state.filters;
  const base = getFiltered(d.group);
  let opts;
  if (d.type === 'multi') {
    const counts = {};
    for (const e of base) counts[e[d.field]] = (counts[e[d.field]] ?? 0) + 1;
    opts = d.options().map(v => ({ id: v, label: v, n: counts[v] ?? 0, checked: f[d.stateKey].includes(v) }));
    if (popQuery) opts = opts.filter(o => normalize(o.label).includes(normalize(popQuery)));
  } else {
    const cur = d.current(f);
    opts = d.options.map(o => ({ id: o.id, label: o.label, n: base.filter(o.test).length, checked: cur === o.id }));
  }

  const list = `
    <div class="fp-list" role="${d.type === 'multi' ? 'group' : 'radiogroup'}" aria-label="${d.label}">
      ${opts.length ? opts.map(o => `
        <label class="fp-opt${o.n ? '' : ' is-empty'}">
          <input type="${d.type === 'multi' ? 'checkbox' : 'radio'}" name="fp-${d.key}" value="${esc(o.id)}" ${o.checked ? 'checked' : ''}>
          <span class="fp-check">${icon('check', 11)}</span>
          ${d.dots ? `<i class="lg-dot t-${tipoKey(o.label)}"></i>` : ''}
          <span class="fp-label">${esc(o.label)}</span>
          <span class="fp-count">${fmt(o.n)}</span>
        </label>`).join('') : '<p class="fp-empty">Nenhuma opção encontrada.</p>'}
    </div>`;

  if (full) {
    const sel = d.type === 'multi' ? f[d.stateKey].length : (d.current(f) ? 1 : 0);
    pop.setAttribute('aria-label', `Filtro: ${d.label}`);
    pop.innerHTML = `
      <div class="fp-head"><strong>${d.label}</strong><button type="button" class="fp-close" aria-label="Fechar">${icon('close', 12)}</button></div>
      ${d.note ? `<p class="fp-note">${d.note}</p>` : ''}
      ${d.search ? `<div class="fp-search-wrap">${icon('search', 13)}<input class="fp-search" type="search" placeholder="Buscar ${d.label.toLowerCase()}…" aria-label="Buscar ${d.label.toLowerCase()}"></div>` : ''}
      <div class="fp-list-wrap">${list}</div>
      <div class="fp-foot"><span class="fp-sel">${sel ? `${sel} selecionado${sel > 1 ? 's' : ''}` : 'Nenhum selecionado'}</span><button type="button" class="fp-reset" ${sel ? '' : 'disabled'}>Limpar</button></div>`;
    pop.querySelector('.fp-close').addEventListener('click', () => _close(true));
    pop.querySelector('.fp-reset').addEventListener('click', () => dispatch('SET_FILTER', d.type === 'multi' ? { [d.stateKey]: [] } : d.clear));
    const s = pop.querySelector('.fp-search');
    s?.addEventListener('input', () => { popQuery = s.value; _paintPop(false); });
  } else {
    const wrap = pop.querySelector('.fp-list-wrap');
    const st = wrap.scrollTop;
    const focused = wrap.contains(document.activeElement) ? document.activeElement.value : null;
    wrap.innerHTML = list;
    wrap.scrollTop = st;
    if (focused != null) wrap.querySelector(`input[value="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    const sel = d.type === 'multi' ? f[d.stateKey].length : (d.current(f) ? 1 : 0);
    pop.querySelector('.fp-sel').textContent = sel ? `${sel} selecionado${sel > 1 ? 's' : ''}` : 'Nenhum selecionado';
    pop.querySelector('.fp-reset').disabled = !sel;
  }

  pop.querySelectorAll('.fp-list input').forEach(inp => {
    inp.addEventListener('click', () => {
      if (d.type === 'multi') {
        const cur = state.filters[d.stateKey];
        dispatch('SET_FILTER', { [d.stateKey]: inp.checked ? [...cur, inp.value] : cur.filter(x => x !== inp.value) });
      } else {
        const o = d.options.find(x => x.id === inp.value);
        dispatch('SET_FILTER', d.current(state.filters) === o.id ? d.clear : { ...d.clear, ...o.apply });
      }
    });
  });
}
