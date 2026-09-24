/**
 * tables.js - Sortable, paginated data table
 */
import { getFiltered, dispatch } from './state.js';
import { fmt, fmtRating, esc, tipoColor, tipoShort, truncate } from './utils.js';

const PAGE_SIZE = 20;
let currentPage = 1;
let sortKey = 'review_rating';
let sortAsc = false;

export function render() {
  const filtered = getFiltered();
  const sorted = _sort(filtered, sortKey, sortAsc);
  const total = sorted.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  currentPage = Math.min(currentPage, Math.max(1, pages));
  const slice = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const html = `
    <div class="table-info" style="font-size:13px;color:var(--text-secondary);margin-bottom:10px">
      Mostrando <strong>${(currentPage-1)*PAGE_SIZE+1}–${Math.min(currentPage*PAGE_SIZE,total)}</strong> de <strong>${fmt(total)}</strong> estabelecimentos
    </div>
    <div class="table-wrap" style="overflow-x:auto">
      <table class="data-table" role="grid">
        <thead>
          <tr>
            ${_th('nome_estabelecimento','Nome')}
            ${_th('bairro_pesquisa','Bairro')}
            ${_th('tipo_estabelecimento','Tipo')}
            ${_th('categoria_padronizada','Categoria')}
            ${_th('review_rating','Nota')}
            ${_th('review_count','Aval.')}
            ${_th('ocorrencias_total','Recorrência')}
            ${_th('estabelecimentos_500m','Pts 500m')}
          </tr>
        </thead>
        <tbody>
          ${slice.map(e => _row(e)).join('')}
        </tbody>
      </table>
    </div>
    ${_pagination(currentPage, pages)}
  `;

  ['table-container', 'table-container-alt'].forEach(id => {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = html;

    container.querySelectorAll('th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (sortKey === key) sortAsc = !sortAsc;
        else { sortKey = key; sortAsc = false; }
        render();
      });
    });

    container.querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        dispatch('SELECT_ESTABLISHMENT', { placeId: tr.dataset.id });
        document.getElementById('map-section')?.scrollIntoView({ behavior: 'smooth' });
      });
      tr.style.cursor = 'pointer';
    });

    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPage = parseInt(btn.dataset.page);
        render();
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  });
}

function _th(key, label) {
  const active = sortKey === key;
  const arrow = active ? (sortAsc ? ' ↑' : ' ↓') : '';
  return `<th data-key="${key}" style="cursor:pointer;white-space:nowrap;${active?'color:var(--acai-mid);':''}">${label}${arrow}</th>`;
}

function _row(e) {
  const color = tipoColor(e.tipo_estabelecimento);
  return `
    <tr data-id="${esc(e.place_id)}" class="table-row">
      <td style="max-width:200px">
        <div style="font-weight:600;font-size:13px">${esc(truncate(e.nome_estabelecimento, 35))}</div>
        ${e.endereco ? `<div style="font-size:11px;color:var(--text-muted)">${esc(truncate(e.endereco, 40))}</div>` : ''}
      </td>
      <td style="white-space:nowrap">${esc(e.bairro_pesquisa ?? '—')}</td>
      <td>
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${color}22;color:${color};font-size:11px;font-weight:600;white-space:nowrap">
          ${tipoShort(e.tipo_estabelecimento)}
        </span>
      </td>
      <td style="font-size:12px;color:var(--text-secondary)">${esc(e.categoria_padronizada || '—')}</td>
      <td style="font-weight:700;color:${_ratingColor(e.review_rating)}">${e.review_rating ? fmtRating(e.review_rating) : '—'}</td>
      <td style="text-align:right">${fmt(e.review_count ?? 0)}</td>
      <td style="text-align:center;font-weight:600;color:var(--acai-mid)">${fmt(e.ocorrencias_total ?? 0)}</td>
      <td style="text-align:center">${fmt(e.estabelecimentos_500m ?? 0)}</td>
    </tr>
  `;
}

function _ratingColor(r) {
  if (!r) return 'var(--text-muted)';
  if (r >= 4.5) return '#2E7D32';
  if (r >= 4.0) return '#4B286D';
  if (r >= 3.5) return '#E6A817';
  return '#C8102E';
}

function _sort(arr, key, asc) {
  return [...arr].sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'pt-BR');
    return asc ? cmp : -cmp;
  });
}

function _pagination(cur, total) {
  if (total <= 1) return '';
  const pages = [];
  const range = (s, e) => Array.from({ length: e - s + 1 }, (_, i) => s + i);
  let nums;
  if (total <= 7) nums = range(1, total);
  else if (cur <= 4) nums = [...range(1, 5), '…', total];
  else if (cur >= total - 3) nums = [1, '…', ...range(total - 4, total)];
  else nums = [1, '…', ...range(cur - 1, cur + 1), '…', total];

  return `<div style="display:flex;justify-content:center;gap:6px;margin-top:16px;flex-wrap:wrap">
    <button data-page="${Math.max(1,cur-1)}" class="filter-btn" ${cur===1?'disabled':''}>← Anterior</button>
    ${nums.map(n => n === '…'
      ? `<span style="display:flex;align-items:center;padding:0 4px;color:var(--text-muted)">…</span>`
      : `<button data-page="${n}" class="filter-btn${n===cur?' active':''}${n===cur?' btn-primary':''}" style="${n===cur?'background:var(--acai-mid);color:#fff;border-color:var(--acai-mid)':''}">${n}</button>`
    ).join('')}
    <button data-page="${Math.min(total,cur+1)}" class="filter-btn" ${cur===total?'disabled':''}>Próxima →</button>
  </div>`;
}
