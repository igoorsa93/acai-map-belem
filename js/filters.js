/**
 * filters.js - Filter UI rendering and management
 */
import { getBairros, getTipos, getCategorias } from './data.js';
import { state, dispatch, hasActiveFilters } from './state.js';
import { esc } from './utils.js';

export function render() {
  renderDropdowns();
  renderChips();
}

function renderDropdowns() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;

  // Bairro
  _upsertSelect(bar, 'filter-bairro', 'Todos os bairros', getBairros(), (val) => {
    const cur = state.filters.bairros;
    if (val === '') dispatch('SET_FILTER', { bairros: [] });
    else if (!cur.includes(val)) dispatch('SET_FILTER', { bairros: [...cur, val] });
  });

  // Tipo
  _upsertSelect(bar, 'filter-tipo', 'Todos os tipos', getTipos(), (val) => {
    const cur = state.filters.tipos;
    if (val === '') dispatch('SET_FILTER', { tipos: [] });
    else if (!cur.includes(val)) dispatch('SET_FILTER', { tipos: [...cur, val] });
  });

  // Categoria
  _upsertSelect(bar, 'filter-cat', 'Todas as categorias', getCategorias().slice(0, 20), (val) => {
    const cur = state.filters.categorias;
    if (val === '') dispatch('SET_FILTER', { categorias: [] });
    else if (!cur.includes(val)) dispatch('SET_FILTER', { categorias: [...cur, val] });
  });

  // Rating
  _upsertSelect(bar, 'filter-rating', 'Qualquer nota', [
    { label: '4.5+', value: '4.5' },
    { label: '4.0+', value: '4.0' },
    { label: '3.5+', value: '3.5' },
    { label: '3.0+', value: '3.0' },
  ], (val) => {
    dispatch('SET_FILTER', { ratingMin: val ? parseFloat(val) : null });
  }, true);
}

function _upsertSelect(bar, id, placeholder, options, onChange, isObj = false) {
  let sel = document.getElementById(id);
  if (!sel) {
    sel = document.createElement('select');
    sel.id = id;
    sel.className = 'filter-select';
    sel.setAttribute('aria-label', placeholder);
    bar.insertBefore(sel, document.getElementById('active-chips'));
    sel.addEventListener('change', e => { onChange(e.target.value); sel.value = ''; });
  }
  // Rebuild options if count differs
  if (sel.options.length !== options.length + 1) {
    sel.innerHTML = `<option value="">${esc(placeholder)}</option>`;
    for (const o of options) {
      const val = isObj ? o.value : o;
      const lbl = isObj ? o.label : o;
      sel.innerHTML += `<option value="${esc(val)}">${esc(lbl)}</option>`;
    }
  }
}

export function renderChips() {
  const container = document.getElementById('active-chips');
  if (!container) return;
  container.innerHTML = '';

  const { bairros, tipos, categorias, ratingMin, search } = state.filters;

  bairros.forEach(b => container.appendChild(_chip(`Bairro: ${b}`, () => {
    dispatch('SET_FILTER', { bairros: state.filters.bairros.filter(x => x !== b) });
  })));

  tipos.forEach(t => container.appendChild(_chip(`Tipo: ${t}`, () => {
    dispatch('SET_FILTER', { tipos: state.filters.tipos.filter(x => x !== t) });
  })));

  categorias.forEach(c => container.appendChild(_chip(`Cat: ${c}`, () => {
    dispatch('SET_FILTER', { categorias: state.filters.categorias.filter(x => x !== c) });
  })));

  if (ratingMin != null) container.appendChild(_chip(`Nota ≥ ${ratingMin}`, () => {
    dispatch('SET_FILTER', { ratingMin: null });
  }));

  if (search) container.appendChild(_chip(`"${search}"`, () => {
    dispatch('SET_FILTER', { search: '' });
    const inp = document.getElementById('header-search-input');
    if (inp) inp.value = '';
  }));

  // Clear all button
  let clearBtn = document.getElementById('clear-filters-btn');
  if (hasActiveFilters()) {
    if (!clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.id = 'clear-filters-btn';
      clearBtn.className = 'filter-btn clear-btn';
      clearBtn.textContent = 'Limpar filtros';
      clearBtn.addEventListener('click', () => dispatch('CLEAR_FILTERS'));
      document.getElementById('filter-bar')?.appendChild(clearBtn);
    }
    clearBtn.style.display = '';
  } else if (clearBtn) {
    clearBtn.style.display = 'none';
  }
}

function _chip(label, onRemove) {
  const span = document.createElement('span');
  span.className = 'filter-chip';
  span.innerHTML = `${esc(label)}<button class="remove-chip" aria-label="Remover filtro">×</button>`;
  span.querySelector('.remove-chip').addEventListener('click', onRemove);
  return span;
}
