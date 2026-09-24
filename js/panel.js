/**
 * panel.js - Painel de contexto do mapa: resumo da área ↔ detalhes do estabelecimento
 */
import { state, dispatch, getFiltered, activeFilterCount } from './state.js';
import { getByPlaceId, establishments } from './data.js';
import { countInRadius } from './map.js';
import { fmt, fmtRating, fmtDist, esc, tipoKey, TIPOS, icon, reducedMotion } from './utils.js';

const RADII = [0.5, 1, 2];

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
    if (sel) updateRadiusUI();
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

  return `
    <button class="pb-back" data-action="back">${icon('back', 14)} Voltar ao resumo</button>

    <div class="pb-tipo t-${k}"><i class="lg-dot t-${k}"></i>${esc(e.tipo_estabelecimento)}</div>
    <h3 class="pb-name">${esc(e.nome_estabelecimento)}</h3>
    <div class="pb-cat">${esc(cat)}</div>

    <div class="pb-rating">
      ${hasRating
        ? `<span class="pb-rating-num">${icon('star', 15)} ${fmtRating(e.review_rating)}</span>
           <span class="pb-rating-count">${fmt(e.review_count)} ${e.review_count === 1 ? 'avaliação' : 'avaliações'}</span>`
        : `<span class="pb-missing">Sem avaliações no Google Maps</span>`}
    </div>

    <div class="pb-addr">
      ${icon('pin', 15)}
      <div>
        <strong>${esc(e.bairro_pesquisa ?? '')}${bairroReal ? ` <span>· endereço em ${esc(bairroReal)}</span>` : ''}</strong>
        <span>${addr ? esc(addr) : 'Endereço completo não informado'}</span>
      </div>
    </div>

    <section class="pb-sec">
      <div class="pb-sec-title">Recorrência</div>
      <div class="pb-big">${fmt(e.ocorrencias_total)} <small>${e.ocorrencias_total === 1 ? 'ocorrência' : 'ocorrências'} nas consultas</small></div>
      ${termos.length ? `<div class="pb-terms">${termos.map(t => `<span class="pb-term">${esc(t)}</span>`).join('')}</div>` : ''}
    </section>

    <section class="pb-sec">
      <div class="pb-sec-title">Localização</div>
      <div class="pb-kv"><span>Distância do bairro pesquisado</span><strong>${fmtDist(e.distancia_bairro_pesquisa_km)}</strong></div>
      <div class="pb-kv"><span>Vizinho mais próximo</span><strong>${fmtDist(e.dist_vizinho_mais_proximo_km)}</strong></div>
      <div class="pb-density">
        <div><strong>${fmt(e.estabelecimentos_500m)}</strong><span>em 500 m</span></div>
        <div><strong>${fmt(e.estabelecimentos_1km)}</strong><span>em 1 km</span></div>
        <div><strong>${fmt(e.estabelecimentos_2km)}</strong><span>em 2 km</span></div>
      </div>
      ${flag ? `<p class="pb-flag">${icon('alert', 13)} Coleta marcou este ponto como “${esc(e.flag_distancia)}”: está a ${fmtDist(e.distancia_bairro_pesquisa_km)} do bairro pesquisado.</p>` : ''}
    </section>

    <section class="pb-sec">
      <div class="pb-sec-title">Raio de proximidade</div>
      <div class="pb-seg" role="radiogroup" aria-label="Raio de proximidade">
        ${RADII.map(r => `<button role="radio" aria-checked="false" data-radius="${r}">${r < 1 ? '500 m' : `${r} km`}</button>`).join('')}
      </div>
      <p class="pb-radius-note" id="pb-radius-note" aria-live="polite">Escolha um raio para desenhá-lo no mapa.</p>
    </section>

    ${e.telefone || e.website ? `
    <section class="pb-sec pb-contact">
      ${e.telefone ? `<div class="pb-kv"><span>${icon('phone', 13)} Telefone</span><strong>${esc(e.telefone)}</strong></div>` : ''}
      ${e.website ? `<div class="pb-kv"><span>${icon('globe', 13)} Site</span><a href="${esc(e.website)}" target="_blank" rel="noopener noreferrer">abrir</a></div>` : ''}
    </section>` : ''}

    ${e.link ? `<a class="pb-cta" href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">Abrir no Google Maps ${icon('external', 14)}</a>` : ''}`;
}

export function updateRadiusUI() {
  const km = state.radiusKm;
  document.querySelectorAll('.pb-seg [data-radius]').forEach(b => {
    b.setAttribute('aria-checked', String(parseFloat(b.dataset.radius) === km));
  });
  const note = document.getElementById('pb-radius-note');
  if (!note) return;
  if (!km) { note.textContent = 'Escolha um raio para desenhá-lo no mapa.'; return; }
  const n = countInRadius(km);
  const label = km < 1 ? '500 m' : `${km} km`;
  note.innerHTML = `<strong>${fmt(n)}</strong> outro${n === 1 ? '' : 's'} ponto${n === 1 ? '' : 's'} visíve${n === 1 ? 'l' : 'is'} em ${label}${activeFilterCount() ? ' (com os filtros atuais)' : ''}.`;
}

function _bind(root) {
  root.querySelector('[data-action="back"]')?.addEventListener('click', () => dispatch('SELECT_ESTABLISHMENT', { placeId: null }));
  root.querySelector('[data-action="clear-filters"]')?.addEventListener('click', () => dispatch('CLEAR_FILTERS'));
  root.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => dispatch('SET_FILTER', { tipos: [b.dataset.tipo] })));
  root.querySelectorAll('[data-bairro]').forEach(b => b.addEventListener('click', () => dispatch('SET_FILTER', { bairros: [b.dataset.bairro] })));
  root.querySelectorAll('[data-radius]').forEach(b => b.addEventListener('click', () => {
    const km = parseFloat(b.dataset.radius);
    dispatch('SET_RADIUS', { km: state.radiusKm === km ? null : km });
  }));
}
