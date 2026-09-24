/**
 * data.js - Data access helpers wrapping window.ACAI_MAP_DATA
 */

export const establishments = window.ACAI_MAP_DATA.establishments;
export const occurrences    = window.ACAI_MAP_DATA.occurrences;
export const queries        = window.ACAI_MAP_DATA.queries;
export const neighborhoods  = window.ACAI_MAP_DATA.neighborhoods;

export function getByPlaceId(id) {
  return establishments.find(e => e.place_id === id) ?? null;
}

export function getBairros() {
  return [...new Set(establishments.map(e => e.bairro_pesquisa).filter(Boolean))].sort();
}

export function getTipos() {
  return [...new Set(establishments.map(e => e.tipo_estabelecimento).filter(Boolean))].sort();
}

export function getCategorias() {
  return [...new Set(establishments.map(e => e.categoria_padronizada).filter(Boolean))].sort();
}

/** Aggregate term occurrences from queries data */
export function getTermosStats() {
  const map = {};
  for (const q of queries) {
    const t = q.termo_pesquisa?.trim();
    if (!t) continue;
    if (!map[t]) map[t] = { termo: t, total: 0 };
    map[t].total += parseInt(q.quantidade_resultados ?? 0, 10) || 0;
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

/** Aggregate occurrences per term from fact table */
export function getOccurrencesByTerm() {
  const map = {};
  for (const o of occurrences) {
    const t = o.termo_pesquisa?.trim();
    if (!t) continue;
    map[t] = (map[t] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([termo, count]) => ({ termo, count }))
    .sort((a, b) => b.count - a.count);
}

/** Global KPI summaries */
export function getGlobalStats() {
  const valid = establishments.filter(e => e.review_rating > 0);
  const totalRatings = establishments.reduce((s, e) => s + (e.review_count ?? 0), 0);
  const avgRating = valid.length
    ? valid.reduce((s, e) => s + (e.review_rating ?? 0), 0) / valid.length
    : 0;
  return {
    total: establishments.length,
    occurrencesTotal: occurrences.length,
    avgRating,
    totalRatings,
    bairros: getBairros().length,
    queries: queries.length,
  };
}
