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
    { k: 'Maior presença na base', v: topB, n: topBn, u: topBn === 1 ? 'estabelecimento' : 'estabelecimentos', act: `bairro:${topB}` },
    { k: 'Maior recorrência', v: recorr.nome_estabelecimento, n: recorr.ocorrencias_total, u: recorr.ocorrencias_total === 1 ? 'consulta' : 'consultas', act: `sel:${recorr.place_id}` },
    reviews.review_count > 0
      ? { k: 'Maior volume de avaliações', v: reviews.nome_estabelecimento, n: reviews.review_count, u: `avaliações · nota ${fmtRating(reviews.review_rating)}`, act: `sel:${reviews.place_id}` }
      : { k: 'Maior volume de avaliações', v: 'Sem avaliações', n: null, u: 'nenhum resultado tem avaliações no Google', act: null },
    { k: 'Maior densidade local', v: dens.nome_estabelecimento, n: dens.estabelecimentos_500m, u: 'pontos em 500 m', act: `sel:${dens.place_id}` },
  ];

  grid.innerHTML = cards.map((c, i) => `
    <button type="button" class="ins-card" ${c.act ? `data-act="${esc(c.act)}"` : 'disabled'}>
      <span class="ins-top"><span class="ins-idx">${String(i + 1).padStart(2, '0')}</span><span class="ins-k">${c.k}</span></span>
      <span class="ins-v">${esc(c.v)}</span>
      <span class="ins-m">${c.n != null ? `<strong>${fmt(c.n)}</strong> ` : ''}${c.u}</span>
      ${c.act ? `<span class="ins-go">${c.act.startsWith('bairro') ? 'Filtrar bairro' : 'Ver no mapa'} ${icon('arrow', 12)}</span>` : ''}
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
