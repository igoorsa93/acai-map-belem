/**
 * kpis.js - KPI cards rendering with count-up animation
 */
import { getGlobalStats, getByPlaceId } from './data.js';
import { state, getFiltered } from './state.js';
import { fmt, fmtRating, countUp, starsHtml } from './utils.js';

const ICONS = {
  estabs:     '📍',
  occs:       '🔍',
  rating:     '⭐',
  reviews:    '💬',
  bairros:    '🗺️',
  queries:    '📊',
  dist:       '📏',
  viz500:     '🏘️',
  viz1k:      '🏙️',
  recorr:     '🔁',
};

export function render() {
  const grid = document.getElementById('kpi-grid');
  if (!grid) return;

  const global = getGlobalStats();
  const filtered = getFiltered();
  const sel = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;

  if (sel) {
    _renderSelected(grid, sel);
  } else {
    _renderGlobal(grid, global, filtered);
  }
}

function _renderGlobal(grid, g, filtered) {
  const cards = [
    {
      id: 'kpi-estabs',
      icon: ICONS.estabs,
      label: 'Estabelecimentos',
      value: filtered.length,
      sub: filtered.length < g.total ? `de ${fmt(g.total)} total` : 'únicos mapeados',
      accent: '#4B286D',
    },
    {
      id: 'kpi-occs',
      icon: ICONS.occs,
      label: 'Ocorrências de Busca',
      value: g.occurrencesTotal,
      sub: 'nas consultas Google Maps',
      accent: '#3F6B4F',
    },
    {
      id: 'kpi-rating',
      icon: ICONS.rating,
      label: 'Avaliação Média',
      value: parseFloat(_filteredAvgRating(filtered).toFixed(1)),
      sub: `${starsHtml(Math.round(_filteredAvgRating(filtered)))}`,
      accent: '#E6A817',
      decimals: 1,
    },
    {
      id: 'kpi-reviews',
      icon: ICONS.reviews,
      label: 'Total de Avaliações',
      value: filtered.reduce((s, e) => s + (e.review_count ?? 0), 0),
      sub: 'avaliações no Google Maps',
      accent: '#003DA5',
    },
    {
      id: 'kpi-bairros',
      icon: ICONS.bairros,
      label: 'Bairros',
      value: new Set(filtered.map(e => e.bairro_pesquisa)).size,
      sub: 'bairros pesquisados',
      accent: '#C8102E',
    },
    {
      id: 'kpi-queries',
      icon: ICONS.queries,
      label: 'Consultas',
      value: g.queries,
      sub: 'consultas realizadas',
      accent: '#8E5AA8',
    },
  ];
  _setCards(grid, cards);
}

function _renderSelected(grid, sel) {
  const cards = [
    {
      id: 'kpi-sel-rating',
      icon: ICONS.rating,
      label: 'Avaliação',
      value: parseFloat((sel.review_rating ?? 0).toFixed(1)),
      sub: starsHtml(Math.round(sel.review_rating ?? 0)),
      accent: '#E6A817',
      decimals: 1,
    },
    {
      id: 'kpi-sel-reviews',
      icon: ICONS.reviews,
      label: 'Avaliações',
      value: sel.review_count ?? 0,
      sub: 'avaliações no Google',
      accent: '#003DA5',
    },
    {
      id: 'kpi-sel-recorr',
      icon: ICONS.recorr,
      label: 'Recorrência',
      value: sel.ocorrencias_total ?? 0,
      sub: 'ocorrências nas buscas',
      accent: '#4B286D',
    },
    {
      id: 'kpi-sel-dist',
      icon: ICONS.dist,
      label: 'Dist. bairro referência',
      value: sel.distancia_bairro_pesquisa_km ?? 0,
      sub: 'km do bairro pesquisado',
      accent: '#3F6B4F',
      decimals: 2,
    },
    {
      id: 'kpi-sel-viz500',
      icon: ICONS.viz500,
      label: 'Vizinhança 500m',
      value: sel.estabelecimentos_500m ?? 0,
      sub: 'estabelecimentos próximos',
      accent: '#C8102E',
    },
    {
      id: 'kpi-sel-viz1k',
      icon: ICONS.viz1k,
      label: 'Vizinhança 1km',
      value: sel.estabelecimentos_1km ?? 0,
      sub: 'estabelecimentos no raio',
      accent: '#8E5AA8',
    },
  ];
  _setCards(grid, cards);
}

function _setCards(grid, cards) {
  // If IDs match, just update values; else rebuild
  const firstCard = grid.querySelector('.kpi-card');
  if (firstCard && firstCard.id === cards[0].id) {
    cards.forEach(c => {
      const valEl = document.getElementById(c.id + '-val');
      if (valEl) countUp(valEl, c.value, 900, c.decimals ?? 0);
    });
    return;
  }
  grid.innerHTML = cards.map(c => `
    <div class="kpi-card" id="${c.id}" style="--card-accent:${c.accent}">
      <div class="kpi-icon">${c.icon}</div>
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value" id="${c.id}-val" data-target="${c.value}">${fmt(0, c.decimals ?? 0)}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>
  `).join('');
  // Trigger count-up
  cards.forEach(c => {
    const el = document.getElementById(c.id + '-val');
    if (el) countUp(el, c.value, 800, c.decimals ?? 0);
  });
}

function _filteredAvgRating(filtered) {
  const valid = filtered.filter(e => e.review_rating > 0);
  return valid.length ? valid.reduce((s, e) => s + e.review_rating, 0) / valid.length : 0;
}
