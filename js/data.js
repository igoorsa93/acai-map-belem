/**
 * data.js - Data access helpers wrapping window.ACAI_MAP_DATA
 */

export const establishments = window.ACAI_MAP_DATA.establishments;
export const occurrences    = window.ACAI_MAP_DATA.occurrences;
export const queries        = window.ACAI_MAP_DATA.queries;
export const neighborhoods  = window.ACAI_MAP_DATA.neighborhoods;

const _byId = new Map(establishments.map(e => [e.place_id, e]));

export function getByPlaceId(id) {
  return _byId.get(id) ?? null;
}

export function getBairros() {
  return [...new Set(establishments.map(e => e.bairro_pesquisa).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function getTipos() {
  return [...new Set(establishments.map(e => e.tipo_estabelecimento).filter(Boolean))].sort();
}

export function getCategorias() {
  return [...new Set(establishments.map(e => e.categoria_padronizada).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function getTermos() {
  return [...new Set(occurrences.map(o => o.termo_pesquisa?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Ocorrências (fato) por termo, restritas a um conjunto de place_ids */
export function getOccurrencesByTerm(placeIds = null) {
  const map = {};
  for (const o of occurrences) {
    if (placeIds && !placeIds.has(o.place_id)) continue;
    const t = o.termo_pesquisa?.trim();
    if (!t) continue;
    map[t] = (map[t] ?? 0) + 1;
  }
  return Object.entries(map)
    .map(([termo, count]) => ({ termo, count }))
    .sort((a, b) => b.count - a.count);
}

/** Consultas distintas em que um conjunto de estabelecimentos apareceu */
export function countQueriesFor(placeIds) {
  const ids = new Set();
  for (const o of occurrences) if (placeIds.has(o.place_id)) ids.add(o.consulta_id);
  return ids.size;
}

export function getCollectionDate() {
  const d = establishments.map(e => e.data_coleta).filter(Boolean).sort().pop();
  if (!d) return null;
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

/** Bounds robustos (percentis 2–98) para não enquadrar outliers distantes */
export function robustBounds(list) {
  const pts = list.filter(e => e.latitude && e.longitude);
  if (!pts.length) return null;
  if (pts.length < 8) {
    const lats = pts.map(e => e.latitude), lngs = pts.map(e => e.longitude);
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
  }
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
  const lats = pts.map(e => e.latitude), lngs = pts.map(e => e.longitude);
  return [[q(lats, .02), q(lngs, .02)], [q(lats, .98), q(lngs, .98)]];
}

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
    rated: valid.length,
    bairros: getBairros().length,
    queries: queries.length,
  };
}
