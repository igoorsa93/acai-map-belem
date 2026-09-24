/**
 * interactions.js - Navegação, transição de página, busca com autocomplete, atalhos
 */
import { state, dispatch } from './state.js';
import { establishments } from './data.js';
import { debounce, normalize, esc, tipoKey, tipoShort, reducedMotion } from './utils.js';

const VIEWS = ['overview', 'mapa', 'graficos', 'tabela', 'bairros', 'sobre'];

export function init() {
  _initNav();
  _initSearch();
  _initKeyboard();
  document.querySelectorAll('[data-view-link]').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    if (state.activeView !== a.dataset.viewLink) dispatch('SET_VIEW', { view: a.dataset.viewLink });
    else window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    document.getElementById(b.dataset.goto)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }));
}

function _initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.view && btn.dataset.view !== state.activeView) dispatch('SET_VIEW', { view: btn.dataset.view });
    });
  });
}

/* ── Busca global ──────────────────────────────── */
let results = [], active = -1;

function _initSearch() {
  const input = document.getElementById('header-search-input');
  const list = document.getElementById('search-results');
  if (!input || !list) return;

  const index = establishments.map(e => ({ e, n: normalize(e.nome_estabelecimento) }));

  const run = debounce(() => {
    const q = normalize(input.value);
    if (q.length < 2) { _hide(); return; }
    const starts = [], contains = [];
    for (const it of index) {
      const i = it.n.indexOf(q);
      if (i === 0) starts.push(it); else if (i > 0) contains.push(it);
    }
    results = [...starts, ...contains].slice(0, 8).map(x => x.e);
    active = results.length ? 0 : -1;
    _paint(input.value, q);
  }, 90);

  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (normalize(input.value).length >= 2) run(); });
  input.addEventListener('keydown', ev => {
    if (list.hidden) { if (ev.key === 'Enter' && input.value.trim()) _applyText(input); return; }
    const total = results.length + 1;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = (active + 1) % total; _mark(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = (active - 1 + total) % total; _mark(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (active >= 0 && active < results.length) _choose(results[active], input);
      else _applyText(input);
    } else if (ev.key === 'Escape') { _hide(); }
  });
  document.addEventListener('mousedown', ev => {
    if (!ev.target.closest('#header-search')) _hide();
  });
}

function _paint(raw, q) {
  const input = document.getElementById('header-search-input');
  const list = document.getElementById('search-results');
  const hl = name => {
    const i = normalize(name).indexOf(q);
    if (i < 0) return esc(name);
    return `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, i + q.length))}</mark>${esc(name.slice(i + q.length))}`;
  };
  list.innerHTML = `
    ${results.length ? results.map((e, i) => `
      <li role="option" id="sr-${i}" class="sr-item" data-i="${i}" aria-selected="false">
        <i class="lg-dot t-${tipoKey(e.tipo_estabelecimento)}"></i>
        <span class="sr-name">${hl(e.nome_estabelecimento)}</span>
        <span class="sr-meta">${esc(e.bairro_pesquisa ?? '')} · ${tipoShort(e.tipo_estabelecimento)}</span>
      </li>`).join('') : '<li class="sr-empty" role="presentation">Nenhum estabelecimento com esse nome.</li>'}
    <li role="option" id="sr-${results.length}" class="sr-item sr-filter" data-i="${results.length}" aria-selected="false">
      Filtrar tudo por “${esc(raw.trim())}”
    </li>`;
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  list.querySelectorAll('.sr-item').forEach(li => {
    li.addEventListener('mousedown', ev => {
      ev.preventDefault();
      const i = +li.dataset.i;
      if (i < results.length) _choose(results[i], input); else _applyText(input);
    });
    li.addEventListener('mousemove', () => { active = +li.dataset.i; _mark(); });
  });
  _mark();
}

function _mark() {
  const input = document.getElementById('header-search-input');
  document.querySelectorAll('#search-results .sr-item').forEach(li => {
    const on = +li.dataset.i === active;
    li.setAttribute('aria-selected', String(on));
    if (on) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  });
}

function _hide() {
  const list = document.getElementById('search-results');
  const input = document.getElementById('header-search-input');
  if (!list) return;
  list.hidden = true;
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
}

function _choose(e, input) {
  input.value = '';
  _hide();
  input.blur();
  if (state.activeView !== 'overview' && state.activeView !== 'mapa') dispatch('SET_VIEW', { view: 'mapa' });
  dispatch('SELECT_ESTABLISHMENT', { placeId: e.place_id });
  if (state.activeView === 'overview') {
    document.getElementById('map-section')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }
}

function _applyText(input) {
  const v = input.value.trim();
  _hide();
  dispatch('SET_FILTER', { search: v });
}

/* ── Atalhos ───────────────────────────────────── */
function _initKeyboard() {
  document.addEventListener('keydown', e => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (e.key === 'Escape' && !typing && state.selectedPlaceId) dispatch('SELECT_ESTABLISHMENT', { placeId: null });
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('header-search-input')?.focus();
    }
    if (e.key === '/' && !typing) {
      e.preventDefault();
      document.getElementById('header-search-input')?.focus();
    }
  });
}

/* ── Views + transição de página ──────────────── */
export function updateNav(view) {
  document.body.dataset.view = view;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    const on = btn.dataset.view === view;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.dataset.view === view);
  });
  document.querySelectorAll('.persistent-section').forEach(sec => {
    sec.hidden = !(sec.dataset.views || '').split(' ').includes(view);
  });
  document.getElementById('map-section')?.classList.toggle('map-fullscreen', view === 'mapa');

  const app = document.getElementById('app');
  if (app && !reducedMotion()) {
    app.classList.remove('page-enter');
    void app.offsetWidth;
    app.classList.add('page-enter');
  }
}

export { VIEWS };
