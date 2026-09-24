/**
 * tables.js - Tabela paginada, ordenável, com busca local e seleção ligada ao mapa
 */
import { state, getFiltered, dispatch } from './state.js';
import { fmt, fmtRating, esc, tipoKey, tipoShort, truncate, normalize, debounce, reducedMotion } from './utils.js';

let pageSize = 15;
let currentPage = 1;
let sortKey = 'ocorrencias_total';
let sortAsc = false;
let query = '';

const COLS = [
  { key: 'nome_estabelecimento', label: 'Estabelecimento' },
  { key: 'bairro_pesquisa', label: 'Bairro' },
  { key: 'tipo_estabelecimento', label: 'Tipo' },
  { key: 'review_rating', label: 'Nota', num: true },
  { key: 'review_count', label: 'Avaliações', num: true },
  { key: 'ocorrencias_total', label: 'Recorrência', num: true },
  { key: 'estabelecimentos_500m', label: 'Em 500 m', num: true },
];

export function render() {
  const container = document.getElementById('table-container');
  if (!container) return;

  if (!container.dataset.ready) {
    container.dataset.ready = '1';
    container.innerHTML = `
      <div class="tb-toolbar">
        <div class="tb-search">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3" stroke-linecap="round"/></svg>
          <input type="search" id="tb-search" placeholder="Buscar na tabela…" aria-label="Buscar na tabela">
        </div>
        <div class="tb-info" id="tb-info" aria-live="polite"></div>
        <label class="tb-size">Linhas
          <select id="tb-size" aria-label="Linhas por página">
            ${[15, 30, 50].map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="table-wrap"><table class="data-table"><thead></thead><tbody></tbody></table></div>
      <nav class="tb-pages" aria-label="Paginação"></nav>`;
    container.querySelector('#tb-search').addEventListener('input', debounce(ev => {
      query = normalize(ev.target.value); currentPage = 1; render();
    }, 150));
    container.querySelector('#tb-size').addEventListener('change', ev => {
      pageSize = +ev.target.value; currentPage = 1; render();
    });
  }

  let rows = getFiltered();
  if (query) rows = rows.filter(e => normalize(`${e.nome_estabelecimento} ${e.bairro_pesquisa} ${e.categoria_padronizada}`).includes(query));
  rows = _sort(rows);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  currentPage = Math.min(currentPage, pages);
  const slice = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  container.querySelector('#tb-info').innerHTML = total
    ? `<strong>${fmt((currentPage - 1) * pageSize + 1)}–${fmt(Math.min(currentPage * pageSize, total))}</strong> de <strong>${fmt(total)}</strong>`
    : 'Nenhum resultado';

  container.querySelector('thead').innerHTML = `<tr>${COLS.map(c => {
    const on = sortKey === c.key;
    return `<th scope="col" class="${c.num ? 'num' : ''}${on ? ' is-sorted' : ''}" aria-sort="${on ? (sortAsc ? 'ascending' : 'descending') : 'none'}">
      <button type="button" data-key="${c.key}">${c.label}<span class="sort-ic">${on ? (sortAsc ? '↑' : '↓') : '↕'}</span></button></th>`;
  }).join('')}</tr>`;

  const sel = state.selectedPlaceId;
  container.querySelector('tbody').innerHTML = slice.length ? slice.map(e => {
    const k = tipoKey(e.tipo_estabelecimento);
    return `
      <tr data-id="${esc(e.place_id)}" class="${e.place_id === sel ? 'is-selected' : ''}" tabindex="0" aria-selected="${e.place_id === sel}">
        <td><div class="tb-name">${esc(truncate(e.nome_estabelecimento, 44))}</div>
            <div class="tb-sub">${esc(e.categoria_padronizada && e.categoria_padronizada !== 'Não informado' ? e.categoria_padronizada : 'Categoria não informada')}</div></td>
        <td>${esc(e.bairro_pesquisa ?? '—')}</td>
        <td><span class="tb-tipo t-${k}"><i class="lg-dot t-${k}"></i>${tipoShort(e.tipo_estabelecimento)}</span></td>
        <td class="num">${e.review_rating > 0 ? `<strong>${fmtRating(e.review_rating)}</strong>` : '<span class="tb-na">—</span>'}</td>
        <td class="num">${e.review_count ? fmt(e.review_count) : '<span class="tb-na">0</span>'}</td>
        <td class="num">${fmt(e.ocorrencias_total ?? 0)}</td>
        <td class="num">${fmt(e.estabelecimentos_500m ?? 0)}</td>
      </tr>`;
  }).join('') : `<tr><td colspan="${COLS.length}" class="tb-empty">Nenhum estabelecimento corresponde à busca.</td></tr>`;

  container.querySelector('.tb-pages').innerHTML = _pagination(currentPage, pages);
  _bind(container);
}

function _bind(container) {
  container.querySelectorAll('thead [data-key]').forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.key;
    if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = k === 'nome_estabelecimento' || k === 'bairro_pesquisa'; }
    render();
  }));
  container.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    const go = () => {
      dispatch('SELECT_ESTABLISHMENT', { placeId: tr.dataset.id });
      if (state.activeView === 'tabela') dispatch('SET_VIEW', { view: 'mapa' });
      else document.getElementById('map-section')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
  });
  container.querySelectorAll('.tb-pages [data-page]').forEach(btn => btn.addEventListener('click', () => {
    currentPage = +btn.dataset.page;
    render();
    container.querySelector('.table-wrap').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }));
}

function _sort(arr) {
  return [...arr].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === 'review_rating') { av = av > 0 ? av : -1; bv = bv > 0 ? bv : -1; }
    const cmp = typeof av === 'number' || typeof bv === 'number'
      ? (av ?? -1) - (bv ?? -1)
      : String(av ?? '').localeCompare(String(bv ?? ''), 'pt-BR');
    return (sortAsc ? cmp : -cmp) || String(a.nome_estabelecimento).localeCompare(b.nome_estabelecimento, 'pt-BR');
  });
}

function _pagination(cur, total) {
  if (total <= 1) return '';
  const range = (s, e) => Array.from({ length: e - s + 1 }, (_, i) => s + i);
  const nums = total <= 7 ? range(1, total)
    : cur <= 4 ? [...range(1, 5), '…', total]
    : cur >= total - 3 ? [1, '…', ...range(total - 4, total)]
    : [1, '…', cur - 1, cur, cur + 1, '…', total];
  return `
    <button type="button" class="pg-btn" data-page="${cur - 1}" ${cur === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
    ${nums.map(n => n === '…' ? '<span class="pg-gap">…</span>'
      : `<button type="button" class="pg-btn${n === cur ? ' is-current' : ''}" data-page="${n}" ${n === cur ? 'aria-current="page"' : ''}>${n}</button>`).join('')}
    <button type="button" class="pg-btn" data-page="${cur + 1}" ${cur === total ? 'disabled' : ''} aria-label="Próxima página">›</button>`;
}
