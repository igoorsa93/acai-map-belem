/**
 * state.js - Central application state with pub/sub
 */
import { establishments } from './data.js';

export const state = {
  filters: {
    bairros:     [],
    tipos:       [],
    categorias:  [],
    ratingMin:   null,
    ratingMax:   null,
    search:      '',
  },
  selectedPlaceId: null,
  activeView:      'overview',
  radiusKm:        0.5,
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
      state.filters = { bairros: [], tipos: [], categorias: [], ratingMin: null, ratingMax: null, search: '' };
      break;
    case 'SELECT_ESTABLISHMENT':
      state.selectedPlaceId = payload.placeId ?? null;
      break;
    case 'SET_VIEW':
      state.activeView = payload.view;
      break;
    case 'SET_RADIUS':
      state.radiusKm = payload.km;
      break;
    default:
      console.warn('Unknown action:', action);
  }
  notify(action);
}

export function getFiltered() {
  const { bairros, tipos, categorias, ratingMin, ratingMax, search } = state.filters;
  const q = search.toLowerCase().trim();
  return establishments.filter(e => {
    if (bairros.length && !bairros.includes(e.bairro_pesquisa)) return false;
    if (tipos.length && !tipos.includes(e.tipo_estabelecimento)) return false;
    if (categorias.length && !categorias.includes(e.categoria_padronizada)) return false;
    if (ratingMin != null && (e.review_rating ?? 0) < ratingMin) return false;
    if (ratingMax != null && (e.review_rating ?? 0) > ratingMax) return false;
    if (q) {
      const haystack = [
        e.nome_estabelecimento,
        e.endereco,
        e.bairro_pesquisa,
        e.categoria_padronizada,
        e.tipo_estabelecimento,
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function hasActiveFilters() {
  const { bairros, tipos, categorias, ratingMin, ratingMax, search } = state.filters;
  return bairros.length > 0 || tipos.length > 0 || categorias.length > 0 ||
    ratingMin != null || ratingMax != null || search.length > 0;
}
