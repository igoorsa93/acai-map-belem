/**
 * panel.js - Painel de contexto do mapa: resumo da área ↔ detalhes do estabelecimento
 */
import { state, dispatch, getFiltered, activeFilterCount } from './state.js';
import { getByPlaceId, establishments } from './data.js';
import { fmt, fmtRating, fmtDist, esc, tipoKey, tipoShort, TIPOS, icon, reducedMotion } from './utils.js';

export function render() {
  const panel = document.getElementById('detail-panel');
  const body = document.getElementById('panel-body');
  if (!panel || !body) return;

  const sel = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;
  const mode = sel ? `detail:${sel.place_id}` : 'summary';
  panel.classList.toggle('is-open', !!sel);

  const paint = () => {
    body.innerHTML = sel ? _detailHtml(sel) : _summaryHtml(getFiltered());
    _bind(body);
  };

  if (panel.dataset.mode === mode && mode === 'summary') { paint(); return; }
  if (!panel.dataset.mode || reducedMotion()) { panel.dataset.mode = mode; paint(); return; }

  panel.dataset.mode = mode;
  body.classList.add('is-leaving');
  setTimeout(() => {
    paint();
    body.scrollTop = 0;
    body.classList.remove('is-leaving');
  }, 140);
}

/* ── Resumo da área ────────────────────────────── */
function _summaryHtml(list) {
  const n = list.length;
  const filtered = activeFilterCount() > 0;
  const byTipo = TIPOS.map(t => ({ t, c: list.filter(e => e.tipo_estabelecimento === t).length }));
  const byBairro = {};
  for (const e of list) byBairro[e.bairro_pesquisa] = (byBairro[e.bairro_pesquisa] ?? 0) + 1;
  const topB = Object.entries(byBairro).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxB = topB[0]?.[1] ?? 1;
  const rated = list.filter(e => e.review_rating > 0);
  const avg = rated.length ? rated.reduce((s, e) => s + e.review_rating, 0) / rated.length : null;

  if (!n) {
    return `
      <div class="pb-head">
        <div class="pb-eyebrow">Resumo da área</div>
        <h3 class="pb-title">Nenhum estabelecimento</h3>
        <p class="pb-sub">Nenhum ponto corresponde aos filtros atuais.</p>
      </div>
      <button class="pb-link-btn" data-action="clear-filters">Limpar filtros</button>`;
  }

  return `
    <div class="pb-head">
      <div class="pb-eyebrow">Resumo da área</div>
      <h3 class="pb-title">${fmt(n)} <span>estabelecimento${n > 1 ? 's' : ''}</span></h3>
      <p class="pb-sub">${filtered ? `com os filtros aplicados · ${Math.round(n / establishments.length * 100)}% do total` : `em ${Object.keys(byBairro).length} bairros de Belém`}</p>
    </div>

    <section class="pb-sec">
      <div class="pb-sec-title">Por tipo</div>
      ${byTipo.map(({ t, c }) => `
        <button class="pb-bar-row" data-tipo="${esc(t)}" ${c ? '' : 'disabled'}>
          <span class="pb-bar-label"><i class="lg-dot t-${tipoKey(t)}"></i>${esc(t)}</span>
          <span class="pb-bar-val">${fmt(c)}</span>
          <span class="pb-bar-track"><span class="pb-bar-fill t-${tipoKey(t)}" style="width:${n ? (c / n * 100).toFixed(1) : 0}%"></span></span>
        </button>`).join('')}
    </section>

    <section class="pb-sec">
      <div class="pb-sec-title">Bairros com mais pontos</div>
      ${topB.map(([b, c]) => `
        <button class="pb-bar-row" data-bairro="${esc(b)}">
          <span class="pb-bar-label">${esc(b)}</span>
          <span class="pb-bar-val">${fmt(c)}</span>
          <span class="pb-bar-track"><span class="pb-bar-fill" style="width:${(c / maxB * 100).toFixed(1)}%"></span></span>
        </button>`).join('')}
    </section>

    <section class="pb-sec">
      <div class="pb-sec-title">Avaliações no Google</div>
      <div class="pb-kv"><span>Nota média</span><strong>${avg ? fmt(avg, 2) : '—'}</strong></div>
      <div class="pb-kv"><span>Com avaliação</span><strong>${fmt(rated.length)} de ${fmt(n)}</strong></div>
    </section>

    <p class="pb-hint">${icon('pin', 14)} Clique em um ponto do mapa para ver os detalhes do estabelecimento.</p>`;
}

/* ── Detalhes do estabelecimento ───────────────── */
function _detailHtml(e) {
  const k = tipoKey(e.tipo_estabelecimento);
  const hasRating = e.review_rating > 0;
  const cat = e.categoria_padronizada && e.categoria_padronizada !== 'Não informado'
    ? e.categoria_padronizada : 'Categoria não informada';
  const bairroReal = e.bairro_estabelecimento && e.bairro_estabelecimento !== 'Revisar' && e.bairro_estabelecimento !== e.bairro_pesquisa
    ? e.bairro_estabelecimento : null;
  const termos = (e.termos_encontrado || '').split('|').map(s => s.trim()).filter(Boolean);
  const flag = e.flag_distancia && e.flag_distancia !== 'Normal';
  const addr = e.endereco && !/^Belém - PA, \d{5}-\d{3}$/.test(e.endereco) ? e.endereco : null;

  const pct = hasRating ? Math.max(0, Math.min(100, e.review_rating / 5 * 100)) : 0;
  const nq = e.ocorrencias_total ?? 0;

  return `
    <div class="pb-card-top">
      <button class="pb-back" data-action="back">${icon('back', 14)} Resumo</button>
      <span class="pb-tipo t-${k}"><i class="lg-dot t-${k}"></i>${esc(tipoShort(e.tipo_estabelecimento))}</span>
    </div>

    <h3 class="pb-name">${esc(e.nome_estabelecimento)}</h3>
    <div class="pb-cat">${esc(cat)}</div>

    <div class="pb-rating">
      ${hasRating ? `
        <span class="pb-rating-num">${fmtRating(e.review_rating)}</span>
        <span class="pb-rating-side">
          <span class="pb-stars" aria-label="Nota ${fmtRating(e.review_rating)} de 5"><span class="pb-stars-fill" style="width:${pct.toFixed(1)}%">★★★★★</span>★★★★★</span>
          <span class="pb-rating-count">${fmt(e.review_count)} ${e.review_count === 1 ? 'avaliação' : 'avaliações'}</span>
        </span>`
        : `<span class="pb-missing">Sem avaliações no Google Maps</span>`}
    </div>

    <section class="pb-sec">
      <div class="pb-sec-title">Localização</div>
      <div class="pb-loc">
        <strong>${esc(e.bairro_pesquisa ?? '')}${bairroReal ? ` <span>· endereço em ${esc(bairroReal)}</span>` : ''}</strong>
        <span>${esc(e.cidade || 'Belém')} / ${esc(e.estado || 'PA')}</span>
        <span class="pb-addr-line">${addr ? esc(addr) : 'Endereço completo não informado'}</span>
      </div>
      <dl class="pb-coords">
        <div><dt>Lat</dt><dd>${Number(e.latitude).toFixed(6)}</dd></div>
        <div><dt>Lon</dt><dd>${Number(e.longitude).toFixed(6)}</dd></div>
        <div><dt>Do bairro</dt><dd>${fmtDist(e.distancia_bairro_pesquisa_km)}</dd></div>
      </dl>
      ${flag ? `<p class="pb-flag">${icon('alert', 13)} Coleta marcou este ponto como “${esc(e.flag_distancia)}”: está a ${fmtDist(e.distancia_bairro_pesquisa_km)} do bairro pesquisado.</p>` : ''}
    </section>

    <section class="pb-sec">
      <div class="pb-sec-title">Recorrência</div>
      <div class="pb-big">${fmt(nq)} <small>${nq === 1 ? 'consulta' : 'consultas'}</small></div>
      ${termos.length ? `<div class="pb-terms">${termos.map(t => `<span class="pb-term">${esc(t)}</span>`).join('')}</div>` : ''}
    </section>

    <section class="pb-sec">
      <div class="pb-sec-title">Proximidade</div>
      <ul class="pb-prox">
        <li><strong>${fmt(e.estabelecimentos_500m)}</strong> pontos em 500 m</li>
        <li><strong>${fmt(e.estabelecimentos_1km)}</strong> pontos em 1 km</li>
        <li><strong>${fmt(e.estabelecimentos_2km)}</strong> pontos em 2 km</li>
      </ul>
      <p class="pb-prox-note">Vizinho mais próximo a ${fmtDist(e.dist_vizinho_mais_proximo_km)} · desenhe o raio pela barra do mapa.</p>
    </section>

    ${e.telefone || e.website ? `
    <section class="pb-sec pb-contact">
      ${e.telefone ? `<div class="pb-kv"><span>${icon('phone', 13)} Telefone</span><strong>${esc(e.telefone)}</strong></div>` : ''}
      ${e.website ? `<div class="pb-kv"><span>${icon('globe', 13)} Site</span><a href="${esc(e.website)}" target="_blank" rel="noopener noreferrer">abrir</a></div>` : ''}
    </section>` : ''}

    ${e.link ? `<a class="pb-cta" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ${icon('external', 14)}</a>` : ''}`;
}

function _bind(root) {
  root.querySelector('[data-action="back"]')?.addEventListener('click', () => dispatch('SELECT_ESTABLISHMENT', { placeId: null }));
  root.querySelector('[data-action="clear-filters"]')?.addEventListener('click', () => dispatch('CLEAR_FILTERS'));
  root.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => dispatch('SET_FILTER', { tipos: [b.dataset.tipo] })));
  root.querySelectorAll('[data-bairro]').forEach(b => b.addEventListener('click', () => dispatch('SET_FILTER', { bairros: [b.dataset.bairro] })));
}
