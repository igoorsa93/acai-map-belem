/**
 * map.js - Leaflet map management
 */
import { establishments, getByPlaceId } from './data.js';
import { state, dispatch, getFiltered } from './state.js';
import { tipoColor, tipoShort, fmtRating, starsHtml, fmt, esc } from './utils.js';

let map = null;
let miniMap = null;
let markers = {};      // placeId → CircleMarker
let radiusCircle = null;
let miniMarker = null;

const CENTER = [-1.35, -48.45];
const ZOOM = 12;

export function init() {
  if (!window.L) { console.error('Leaflet not loaded'); return; }

  map = L.map('map', {
    center: CENTER,
    zoom: ZOOM,
    preferCanvas: true,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  _buildAllMarkers();
  _renderLegend();
  _renderMapStats();

  // Click outside markers: deselect
  map.on('click', () => {
    if (state.selectedPlaceId) dispatch('SELECT_ESTABLISHMENT', { placeId: null });
  });
}

function _buildAllMarkers() {
  for (const e of establishments) {
    if (!e.latitude || !e.longitude) continue;
    const m = _createMarker(e);
    markers[e.place_id] = m;
    m.addTo(map);
  }
}

function _createMarker(e) {
  const color = tipoColor(e.tipo_estabelecimento);
  const m = L.circleMarker([e.latitude, e.longitude], {
    radius: 6,
    fillColor: color,
    color: '#fff',
    weight: 1.5,
    fillOpacity: 0.85,
  });

  const tipHtml = `
    <div class="tooltip-name">${esc(e.nome_estabelecimento)}</div>
    <div class="tooltip-meta">
      <span class="tooltip-tipo ${_tipoClass(e.tipo_estabelecimento)}">${tipoShort(e.tipo_estabelecimento)}</span>
      <span>⭐ ${fmtRating(e.review_rating)} (${fmt(e.review_count)})</span>
      <span>📍 ${esc(e.bairro_pesquisa ?? '')}</span>
    </div>
  `;
  m.bindTooltip(tipHtml, {
    className: 'leaflet-tooltip-acai',
    direction: 'top',
    offset: [0, -6],
  });

  m.on('click', ev => {
    L.DomEvent.stopPropagation(ev);
    dispatch('SELECT_ESTABLISHMENT', { placeId: e.place_id });
  });

  return m;
}

function _tipoClass(tipo) {
  if (tipo === 'Especializado em açaí') return 'esp';
  if (tipo === 'Açaí + outro segmento') return 'mix';
  return 'out';
}

export function updateMarkers() {
  if (!map) return;
  const visible = new Set(getFiltered().map(e => e.place_id));
  for (const [id, m] of Object.entries(markers)) {
    if (visible.has(id)) {
      if (!map.hasLayer(m)) m.addTo(map);
      m.setStyle({ fillOpacity: state.selectedPlaceId && state.selectedPlaceId !== id ? 0.2 : 0.85 });
    } else {
      if (map.hasLayer(m)) map.removeLayer(m);
    }
  }
  _renderMapStats();
}

export function selectEstablishment(placeId) {
  if (!map) return;

  // Reset all markers
  for (const [id, m] of Object.entries(markers)) {
    if (map.hasLayer(m)) {
      m.setStyle({ radius: 6, fillOpacity: placeId ? 0.25 : 0.85, weight: 1.5 });
    }
  }

  _clearRadius();

  if (!placeId) {
    _updateDetailPanel(null);
    return;
  }

  const e = getByPlaceId(placeId);
  if (!e || !e.latitude) return;

  const m = markers[placeId];
  if (m && map.hasLayer(m)) {
    m.setStyle({ radius: 10, fillOpacity: 1, weight: 2.5 });
    m.bringToFront();
  }

  map.flyTo([e.latitude, e.longitude], 15, { duration: 0.8 });
  _drawRadius(e.latitude, e.longitude, state.radiusKm);
  _updateDetailPanel(e);
  _updateMiniMap(e);
}

function _drawRadius(lat, lon, km) {
  _clearRadius();
  radiusCircle = L.circle([lat, lon], {
    radius: km * 1000,
    color: '#4B286D',
    fillColor: '#8E5AA8',
    fillOpacity: 0.06,
    weight: 1.5,
    dashArray: '6,4',
    className: 'radius-circle',
  }).addTo(map);
}

function _clearRadius() {
  if (radiusCircle && map.hasLayer(radiusCircle)) {
    map.removeLayer(radiusCircle);
    radiusCircle = null;
  }
}

export function updateRadius(km) {
  if (!state.selectedPlaceId) return;
  const e = getByPlaceId(state.selectedPlaceId);
  if (e) _drawRadius(e.latitude, e.longitude, km);
}

function _updateMiniMap(e) {
  const el = document.getElementById('mini-map');
  if (!el) return;
  if (!miniMap) {
    miniMap = L.map('mini-map', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(miniMap);
  }
  miniMap.setView([e.latitude, e.longitude], 15);
  if (miniMarker) miniMap.removeLayer(miniMarker);
  miniMarker = L.circleMarker([e.latitude, e.longitude], {
    radius: 8, fillColor: tipoColor(e.tipo_estabelecimento), color: '#fff', weight: 2, fillOpacity: 1,
  }).addTo(miniMap);
  setTimeout(() => miniMap.invalidateSize(), 100);
}

function _updateDetailPanel(e) {
  const panel = document.getElementById('detail-panel');
  const placeholder = document.getElementById('detail-placeholder');
  const content = document.getElementById('detail-content');
  if (!panel) return;

  if (!e) {
    if (placeholder) placeholder.style.display = 'flex';
    if (content) content.innerHTML = '';
    if (document.getElementById('mini-map-wrap')) document.getElementById('mini-map-wrap').style.display = 'none';
    panel.classList.remove('hidden');
    return;
  }

  if (placeholder) placeholder.style.display = 'none';
  panel.classList.remove('hidden');

  const headerBg = tipoColor(e.tipo_estabelecimento);
  const densityField = state.radiusKm === 0.5 ? 'estabelecimentos_500m' :
    state.radiusKm === 1 ? 'estabelecimentos_1km' : 'estabelecimentos_2km';

  if (content) {
    content.innerHTML = `
      <div class="detail-header" style="background:${headerBg}">
        <button class="detail-close-btn" id="detail-close-btn" aria-label="Fechar painel">×</button>
        <div class="detail-tipo-badge">${tipoShort(e.tipo_estabelecimento)}</div>
        <div class="detail-name">${esc(e.nome_estabelecimento)}</div>
        <div class="detail-meta-row">
          <span>📍 ${esc(e.bairro_pesquisa ?? '')}${e.bairro_estabelecimento && e.bairro_estabelecimento !== e.bairro_pesquisa && e.bairro_estabelecimento !== 'Revisar' ? ` (${esc(e.bairro_estabelecimento)})` : ''}</span>
          ${e.categoria_padronizada ? `<span>🏷️ ${esc(e.categoria_padronizada)}</span>` : ''}
        </div>
      </div>

      <div style="padding:var(--space-md)">

        ${/* Mini map */''}
        <div id="mini-map-wrap">
          <div id="mini-map"></div>
          <div class="radius-toggle-group" style="margin-top:8px">
            <button class="radius-btn ${state.radiusKm===0.5?'active':''}" data-r="0.5">500m</button>
            <button class="radius-btn ${state.radiusKm===1?'active':''}" data-r="1">1 km</button>
            <button class="radius-btn ${state.radiusKm===2?'active':''}" data-r="2">2 km</button>
          </div>
        </div>

        ${/* Rating */''}
        <div class="detail-section">
          <div class="detail-section-title">Avaliação</div>
          <div style="display:flex;align-items:center;gap:12px;padding:8px 0">
            <span class="rating-num">${fmtRating(e.review_rating)}</span>
            <div>
              <div class="stars">${starsHtml(Math.round(e.review_rating ?? 0))}</div>
              <div style="font-size:12px;color:var(--text-muted)">${fmt(e.review_count)} avaliações</div>
            </div>
          </div>
          ${e.review_rating ? `
          <div class="quality-bar-wrap">
            <div class="quality-bar-label"><span>Nota</span><span>${fmtRating(e.review_rating)}/5</span></div>
            <div class="quality-bar-track"><div class="quality-bar-fill" style="width:${(e.review_rating/5*100).toFixed(1)}%;background:${e.review_rating>=4.5?'#2E7D32':e.review_rating>=4?'#8E5AA8':'#E6A817'}"></div></div>
          </div>` : ''}
        </div>

        ${/* Recorrência */''}
        <div class="detail-section">
          <div class="detail-section-title">Dados de Busca</div>
          <div class="detail-stat-row"><span class="detail-stat-label">Ocorrências totais</span><span class="detail-stat-value">${fmt(e.ocorrencias_total)}</span></div>
          <div class="detail-stat-row"><span class="detail-stat-label">Dist. bairro ref.</span><span class="detail-stat-value">${fmt(e.distancia_bairro_pesquisa_km,2)} km</span></div>
          ${e.flag_distancia ? `<div class="detail-stat-row"><span class="detail-stat-label">Flag distância</span><span class="detail-stat-value">${esc(e.flag_distancia)}</span></div>` : ''}
        </div>

        ${/* Vizinhança */''}
        <div class="detail-section">
          <div class="detail-section-title">Densidade</div>
          <div class="density-grid">
            <div class="density-badge"><span class="val">${fmt(e.estabelecimentos_500m)}</span><span class="lbl">em 500m</span></div>
            <div class="density-badge"><span class="val">${fmt(e.estabelecimentos_1km)}</span><span class="lbl">em 1 km</span></div>
            <div class="density-badge"><span class="val">${fmt(e.estabelecimentos_2km)}</span><span class="lbl">em 2 km</span></div>
          </div>
          <div style="margin-top:6px;font-size:11px;color:var(--text-muted)">Dist. vizinho + próximo: ${fmt(e.dist_vizinho_mais_proximo_km,3)} km</div>
        </div>

        ${/* Termos */''}
        ${e.termos_encontrado ? `
        <div class="detail-section">
          <div class="detail-section-title">Termos encontrados</div>
          <div class="termos-list">${e.termos_encontrado.split('|').map(t=>`<span class="termo-chip">${esc(t.trim())}</span>`).join('')}</div>
        </div>` : ''}

        ${/* Contato */''}
        <div class="detail-section">
          <div class="detail-section-title">Informações</div>
          ${e.endereco ? `<div class="detail-stat-row"><span class="detail-stat-label">Endereço</span><span class="detail-stat-value" style="font-size:12px;text-align:right;max-width:60%">${esc(e.endereco)}</span></div>` : ''}
          ${e.telefone ? `<div class="detail-stat-row"><span class="detail-stat-label">Telefone</span><span class="detail-stat-value">${esc(e.telefone)}</span></div>` : ''}
          ${e.price_range ? `<div class="detail-stat-row"><span class="detail-stat-label">Faixa de preço</span><span class="detail-stat-value">${esc(e.price_range)}</span></div>` : ''}
          ${e.status_google ? `<div class="detail-stat-row"><span class="detail-stat-label">Status Google</span><span class="detail-stat-value">${esc(e.status_google)}</span></div>` : ''}
        </div>

        ${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer" class="detail-link-btn">🗺️ Ver no Google Maps</a>` : ''}
        ${e.website ? `<a href="${esc(e.website)}" target="_blank" rel="noopener noreferrer" class="detail-link-btn" style="margin-left:8px">🌐 Website</a>` : ''}

      </div>
    `;

    // Close btn
    document.getElementById('detail-close-btn')?.addEventListener('click', () => {
      dispatch('SELECT_ESTABLISHMENT', { placeId: null });
    });

    // Radius buttons
    content.querySelectorAll('.radius-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const km = parseFloat(btn.dataset.r);
        dispatch('SET_RADIUS', { km });
      });
    });
  }

  // Init mini map after DOM update
  requestAnimationFrame(() => _updateMiniMap(e));
}

function _renderLegend() {
  const ctrl = document.getElementById('map-controls');
  if (!ctrl) return;
  const counts = { esp: 0, mix: 0, out: 0 };
  for (const e of establishments) {
    if (e.tipo_estabelecimento === 'Especializado em açaí') counts.esp++;
    else if (e.tipo_estabelecimento === 'Açaí + outro segmento') counts.mix++;
    else counts.out++;
  }
  const leg = document.createElement('div');
  leg.id = 'map-legend';
  leg.innerHTML = `
    <div class="legend-title">Tipo de Estabelecimento</div>
    <div class="legend-row"><div class="legend-dot" style="background:#4B286D"></div>Especializado em açaí<span class="legend-count">${counts.esp}</span></div>
    <div class="legend-row"><div class="legend-dot" style="background:#3F6B4F"></div>Açaí + outro segmento<span class="legend-count">${counts.mix}</span></div>
    <div class="legend-row"><div class="legend-dot" style="background:#909090"></div>Outro estabelecimento<span class="legend-count">${counts.out}</span></div>
  `;
  ctrl.appendChild(leg);
}

function _renderMapStats() {
  const el = document.getElementById('map-stats-overlay');
  if (el) {
    const n = getFiltered().length;
    el.textContent = `${n} estabelecimento${n !== 1 ? 's' : ''} visível${n !== 1 ? 'is' : ''}`;
  }
}

export function invalidate() {
  if (map) map.invalidateSize();
}
