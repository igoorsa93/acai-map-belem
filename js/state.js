/**
 * state.js - Central application state with pub/sub
 */
import { establishments } from './data.js';
import { normalize } from './utils.js';

const EMPTY_FILTERS = () => ({
  bairros:    [],
  tipos:      [],
  categorias: [],
  termos:     [],
  ratingMin:  null,
  ratingMax:  null,
  noRating:   false,
  reviewsMin: null,
  distMax:    null,
  ocorrMin:   null,
  ocorrMax:   null,
  search:     '',
});

export const state = {
  filters: EMPTY_FILTERS(),
  selectedPlaceId: null,
  activeView:      'overview',
  radiusKm:        null,
  mapMode:         'points',
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(action) {
  for (const fn of listeners) {
    try { fn(action, state); } catch (e) { console.error('State listener error', e); }
  }
}

export function dispatch(action, payload = {}) {
  switch (action) {
    case 'SET_FILTER':
      Object.assign(state.filters, payload);
      break;
    case 'CLEAR_FILTERS':
      state.filters = EMPTY_FILTERS();
      break;
    case 'RESET_ALL':
      state.filters = EMPTY_FILTERS();
      state.selectedPlaceId = null;
      state.radiusKm = null;
      state.mapMode = 'points';
      break;
    case 'SELECT_ESTABLISHMENT':
      state.selectedPlaceId = payload.placeId ?? null;
      state.radiusKm = null;
      break;
    case 'SET_VIEW':
      state.activeView = payload.view;
      break;
    case 'SET_RADIUS':
      state.radiusKm = payload.km ?? null;
      break;
    case 'SET_MAP_MODE':
      state.mapMode = payload.mode;
      break;
    default:
      console.warn('Unknown action:', action);
  }
  notify(action);
}

/* ── Filtering (memoized, with crossfilter "except") ── */
const FILTER_GROUPS = {
  bairros:  ['bairros'],
  tipos:    ['tipos'],
  categorias: ['categorias'],
  termos:   ['termos'],
  rating:   ['ratingMin', 'ratingMax', 'noRating'],
  reviews:  ['reviewsMin'],
  dist:     ['distMax'],
  ocorr:    ['ocorrMin', 'ocorrMax'],
  search:   ['search'],
};

const _cache = new Map();

export function getFiltered(except = null) {
  const f = { ...state.filters };
  if (except) for (const k of FILTER_GROUPS[except] ?? []) f[k] = EMPTY_FILTERS()[k];
  const key = JSON.stringify(f);
  if (_cache.has(key)) return _cache.get(key);
  const res = _apply(f);
  if (_cache.size > 60) _cache.clear();
  _cache.set(key, res);
  return res;
}

function _apply(f) {
  const q = normalize(f.search);
  return establishments.filter(e => {
    if (f.bairros.length && !f.bairros.includes(e.bairro_pesquisa)) return false;
    if (f.tipos.length && !f.tipos.includes(e.tipo_estabelecimento)) return false;
    if (f.categorias.length && !f.categorias.includes(e.categoria_padronizada)) return false;
    if (f.termos.length) {
      const t = (e.termos_encontrado || '').split('|').map(s => s.trim());
      if (!f.termos.some(x => t.includes(x))) return false;
    }
    const r = e.review_rating > 0 ? e.review_rating : null;
    if (f.noRating && r !== null) return false;
    if (f.ratingMin != null && (r === null || r < f.ratingMin)) return false;
    if (f.ratingMax != null && (r === null || r >= f.ratingMax)) return false;
    if (f.reviewsMin != null && (e.review_count ?? 0) < f.reviewsMin) return false;
    if (f.distMax != null && (e.distancia_bairro_pesquisa_km ?? Infinity) > f.distMax) return false;
    if (f.ocorrMin != null && (e.ocorrencias_total ?? 0) < f.ocorrMin) return false;
    if (f.ocorrMax != null && (e.ocorrencias_total ?? 0) > f.ocorrMax) return false;
    if (q) {
      const hay = e._search ?? (e._search = normalize([
        e.nome_estabelecimento, e.endereco, e.bairro_pesquisa, e.categoria_padronizada,
      ].join(' ')));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function activeFilterCount() {
  const f = state.filters;
  return f.bairros.length + f.tipos.length + f.categorias.length + f.termos.length +
    (f.ratingMin != null || f.noRating ? 1 : 0) + (f.reviewsMin != null ? 1 : 0) +
    (f.distMax != null ? 1 : 0) + (f.ocorrMin != null || f.ocorrMax != null ? 1 : 0) +
    (f.search ? 1 : 0);
}

export function hasActiveFilters() {
  return activeFilterCount() > 0;
}
