/**
 * insights.js - "Visão rápida" (destaques dinâmicos) + view de bairros
 */
import { dispatch, getFiltered } from './state.js';
import { establishments } from './data.js';
import { fmt, fmtRating, esc, icon, tipoKey, TIPOS, reducedMotion } from './utils.js';

export function render() {
  const grid = document.getElementById('insights-grid');
  if (!grid) return;
  const list = getFiltered();
  if (!list.length) {
    grid.innerHTML = '<p class="ins-empty">Sem estabelecimentos para os filtros atuais.</p>';
    return;
  }

  const byB = {};
  for (const e of list) byB[e.bairro_pesquisa] = (byB[e.bairro_pesquisa] ?? 0) + 1;
  const [topB, topBn] = Object.entries(byB).sort((a, b) => b[1] - a[1])[0];
  const maxBy = (fn, tie = e => e.review_count ?? 0) =>
    list.reduce((best, e) => (!best || fn(e) > fn(best) || (fn(e) === fn(best) && tie(e) > tie(best)) ? e : best), null);
  const recorr = maxBy(e => e.ocorrencias_total ?? 0);
  const reviews = maxBy(e => e.review_count ?? 0, e => e.review_rating ?? 0);
  const dens = maxBy(e => e.estabelecimentos_500m ?? 0);

  const cards = [
    { ic: 'grid', k: 'Maior concentração', v: topB, m: `${fmt(topBn)} estabelecimentos · ${Math.round(topBn / list.length * 100)}% dos resultados`, act: `bairro:${topB}` },
    { ic: 'repeat', k: 'Maior recorrência', v: recorr.nome_estabelecimento, m: `${fmt(recorr.ocorrencias_total)} ocorrências nas consultas`, act: `sel:${recorr.place_id}` },
    reviews.review_count > 0
      ? { ic: 'chat', k: 'Maior volume de avaliações', v: reviews.nome_estabelecimento, m: `${fmt(reviews.review_count)} avaliações · nota ${fmtRating(reviews.review_rating)}`, act: `sel:${reviews.place_id}` }
      : { ic: 'chat', k: 'Maior volume de avaliações', v: 'Sem avaliações', m: 'nenhum resultado tem avaliações no Google', act: null },
    { ic: 'radius', k: 'Maior densidade local', v: dens.nome_estabelecimento, m: `${fmt(dens.estabelecimentos_500m)} estabelecimentos em 500 m`, act: `sel:${dens.place_id}` },
  ];

  grid.innerHTML = cards.map(c => `
    <button type="button" class="ins-card" ${c.act ? `data-act="${esc(c.act)}"` : 'disabled'}>
      <span class="ins-k">${icon(c.ic, 14)} ${c.k}</span>
      <span class="ins-v">${esc(c.v)}</span>
      <span class="ins-m">${c.m}</span>
      ${c.act ? `<span class="ins-go">${c.act.startsWith('bairro') ? 'Filtrar bairro' : 'Ver no mapa'} →</span>` : ''}
    </button>`).join('');

  grid.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const [type, val] = b.dataset.act.split(/:(.+)/);
    if (type === 'bairro') dispatch('SET_FILTER', { bairros: [val] });
    else dispatch('SELECT_ESTABLISHMENT', { placeId: val });
    document.getElementById('map-section')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }));
}

export function renderBairros() {
  const grid = document.getElementById('bairros-grid');
  if (!grid) return;
  const stats = {};
  for (const e of establishments) {
    const b = e.bairro_pesquisa;
    if (!b) continue;
    stats[b] ??= { n: 0, rated: [], reviews: 0, tipos: { esp: 0, mix: 0, out: 0 } };
    const s = stats[b];
    s.n++;
    if (e.review_rating > 0) s.rated.push(e.review_rating);
    s.reviews += e.review_count ?? 0;
    s.tipos[tipoKey(e.tipo_estabelecimento)]++;
  }
  const rows = Object.entries(stats).sort((a, b) => b[1].n - a[1].n);
  const max = rows[0]?.[1].n ?? 1;

  grid.innerHTML = rows.map(([b, s], i) => {
    const avg = s.rated.length ? s.rated.reduce((x, y) => x + y, 0) / s.rated.length : null;
    return `
      <button type="button" class="bairro-card" data-bairro="${esc(b)}">
        <span class="bc-rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="bc-name">${esc(b)}</span>
        <span class="bc-num">${fmt(s.n)} <small>estabelecimentos</small></span>
        <span class="bc-bar"><span style="width:${(s.n / max * 100).toFixed(1)}%"></span></span>
        <span class="bc-types">${TIPOS.map(t => { const k = tipoKey(t); return s.tipos[k] ? `<span style="flex:${s.tipos[k]}" class="t-${k}" title="${esc(t)}: ${s.tipos[k]}"></span>` : ''; }).join('')}</span>
        <span class="bc-meta">Nota média ${avg ? fmt(avg, 2) : '—'} · ${fmt(s.reviews)} avaliações</span>
        <span class="bc-go">Ver no mapa →</span>
      </button>`;
  }).join('');

  grid.querySelectorAll('[data-bairro]').forEach(btn => btn.addEventListener('click', () => {
    dispatch('SET_FILTER', { bairros: [btn.dataset.bairro] });
    dispatch('SET_VIEW', { view: 'mapa' });
  }));
}
