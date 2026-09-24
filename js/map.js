/**
 * map.js - Leaflet map: clustering, custom markers, concentration, selection, radius
 */
import { establishments, getByPlaceId, robustBounds } from './data.js';
import { state, dispatch, getFiltered, activeFilterCount } from './state.js';
import { tipoKey, tipoShort, esc, truncate, haversine, reducedMotion, countUp, fmt } from './utils.js';

const CENTER = [-1.365, -48.445];
const ZOOM = 12.5;
const DETAIL_ZOOM = 17;       // labels aparecem
const UNCLUSTER_ZOOM = 16;    // pontos individuais
const FIT_PAD = { paddingTopLeft: [40, 110], paddingBottomRight: [60, 50] };  // topbar + legenda

let map, cluster, heat = null, selMarker = null, radiusCircle = null;
const markers = new Map();     // place_id → L.Marker

const dur = s => (reducedMotion() ? 0 : s);

export function init() {
  if (!window.L) { console.error('Leaflet not loaded'); return; }

  map = L.map('map', {
    center: CENTER,
    zoom: ZOOM,
    zoomControl: false,
    zoomSnap: 0.5,
    minZoom: 10,
    maxZoom: 19,
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Aproximar', zoomOutTitle: 'Afastar' }).addTo(map);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    className: 'acai-basemap',
  }).addTo(map);

  map.createPane('selPane').style.zIndex = 640;

  cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: UNCLUSTER_ZOOM,
    maxClusterRadius: z => (z <= 12 ? 72 : z <= 13 ? 60 : z <= 14 ? 48 : 36),
    chunkedLoading: true,
    animate: !reducedMotion(),
    spiderLegPolylineOptions: { weight: 1, color: '#654078', opacity: 0.45 },
    iconCreateFunction: _clusterIcon,
  });

  for (const e of establishments) {
    if (!e.latitude || !e.longitude) continue;
    const m = L.marker([e.latitude, e.longitude], {
      icon: _pinIcon(e, false),
      keyboard: true,
      title: e.nome_estabelecimento,
      alt: e.nome_estabelecimento,
      riseOnHover: true,
    });
    m.__e = e;
    m.__inRadius = false;
    m.bindTooltip(
      `<strong>${esc(e.nome_estabelecimento)}</strong><span>${tipoShort(e.tipo_estabelecimento)} · ${esc(e.bairro_pesquisa ?? '')}</span>`,
      { direction: 'top', offset: [0, -8], className: 'acai-tip', opacity: 1 }
    );
    m.on('click', ev => {
      L.DomEvent.stopPropagation(ev);
      m.closeTooltip();
      dispatch('SELECT_ESTABLISHMENT', { placeId: e.place_id });
    });
    markers.set(e.place_id, m);
  }

  cluster.addLayers([...markers.values()]);
  map.addLayer(cluster);

  const b = robustBounds(establishments);
  if (b) map.fitBounds(b, { ...FIT_PAD, animate: false });

  map.on('zoomend', _syncZoomClass);
  map.on('click', () => { if (state.selectedPlaceId) dispatch('SELECT_ESTABLISHMENT', { placeId: null }); });
  _syncZoomClass();
  _bindToolbar();
  _updateContext(getFiltered());
}

/* ── Icons ─────────────────────────────────────── */
function _pinIcon(e, inRadius) {
  const k = tipoKey(e.tipo_estabelecimento);
  return L.divIcon({
    className: 'acai-pin-wrap',
    html: `<span class="acai-pin t-${k}${inRadius ? ' in-radius' : ''}"></span><span class="acai-pin-label">${esc(truncate(e.nome_estabelecimento, 24))}</span>`,
    iconSize: [22, 22],   // área de clique; o ponto visual tem 10px
    iconAnchor: [11, 11],
  });
}

function _clusterIcon(c) {
  const n = c.getChildCount();
  const size = n < 10 ? 'sm' : n < 40 ? 'md' : 'lg';
  const px = { sm: 34, md: 42, lg: 52 }[size];
  const inR = state.radiusKm ? c.getAllChildMarkers().some(m => m.__inRadius) : false;
  return L.divIcon({
    html: `<div class="acai-cluster c-${size}${inR ? ' in-radius' : ''}"><span>${n}</span></div>`,
    className: 'acai-cluster-wrap',
    iconSize: [px, px],
  });
}

function _selIcon(e) {
  const k = tipoKey(e.tipo_estabelecimento);
  return L.divIcon({
    className: 'acai-sel-wrap',
    html: `<span class="acai-sel t-${k}"><span class="acai-sel-halo"></span><span class="acai-sel-core"></span></span>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/** Reprocessa ícones de cluster só se a camada estiver no mapa (no modo concentração ela sai) */
function _refresh() {
  if (map.hasLayer(cluster)) cluster.refreshClusters();
}

function _syncZoomClass() {
  map.getContainer().classList.toggle('z-detail', map.getZoom() >= DETAIL_ZOOM);
}

/* ── Filters → map ─────────────────────────────── */
export function updateMarkers({ fit = true } = {}) {
  if (!map) return;
  const filtered = getFiltered();
  const layers = [];
  for (const e of filtered) { const m = markers.get(e.place_id); if (m) layers.push(m); }
  cluster.clearLayers();
  cluster.addLayers(layers);
  if (heat && map.hasLayer(heat)) heat.setLatLngs(filtered.map(e => [e.latitude, e.longitude, 1]));
  _updateContext(filtered);

  if (state.selectedPlaceId && !filtered.some(e => e.place_id === state.selectedPlaceId)) {
    setTimeout(() => dispatch('SELECT_ESTABLISHMENT', { placeId: null }), 0);
    return;
  }
  if (state.radiusKm) _markInRadius();
  if (fit && !state.selectedPlaceId) fitTo(filtered);
}

let pendingFit = false;
const isVisible = () => { const c = map.getContainer(); return c.offsetWidth > 0 && c.offsetHeight > 0; };

export function fitTo(list = getFiltered()) {
  const b = robustBounds(list);
  if (!b) return;
  // Mapa oculto (outra view): o contêiner tem tamanho 0 e o cálculo de zoom gera NaN
  if (!isVisible()) { pendingFit = true; return; }
  pendingFit = false;
  map.flyToBounds(b, { ...FIT_PAD, maxZoom: 16, duration: dur(0.45) });
}

export function recenter() {
  map.flyTo(CENTER, ZOOM, { duration: dur(0.45) });
}

function _updateContext(filtered) {
  const countEl = document.getElementById('map-count');
  const label = document.getElementById('map-count-label');
  const sub = document.getElementById('map-context-sub');
  _updateState();
  _syncRadiusUI();
  if (countEl) countUp(countEl, filtered.length, 350, 0);
  if (label) label.textContent = filtered.length === 1 ? 'estabelecimento encontrado' : 'estabelecimentos encontrados';
  if (sub) {
    const n = activeFilterCount();
    const bairros = new Set(filtered.map(e => e.bairro_pesquisa)).size;
    sub.textContent = n
      ? `de ${fmt(establishments.length)} · ${n} filtro${n > 1 ? 's' : ''} ativo${n > 1 ? 's' : ''}`
      : `em ${bairros} bairros de Belém`;
  }
}

/** Indicador de estado no topo do mapa: visão geral / filtro / seleção */
function _updateState() {
  const box = document.getElementById('map-state');
  const label = document.getElementById('map-state-label');
  if (!box || !label) return;
  const f = state.filters;
  let kind = 'all', text = 'Visão geral';
  const sel = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;
  if (sel) {
    kind = 'sel';
    text = `Selecionado · ${sel.nome_estabelecimento}`;
  } else if (activeFilterCount()) {
    const parts = [];
    if (f.bairros.length) parts.push(f.bairros.length === 1 ? f.bairros[0] : `${f.bairros.length} bairros`);
    if (f.tipos.length) parts.push(f.tipos.length === 1 ? f.tipos[0] : `${f.tipos.length} tipos`);
    const rest = activeFilterCount() - f.bairros.length - f.tipos.length;
    if (rest > 0) parts.push(`+${rest} filtro${rest > 1 ? 's' : ''}`);
    kind = 'filter';
    text = parts.join(' · ');
  }
  box.dataset.kind = kind;
  label.textContent = text;
  box.title = text;
}

function _syncRadiusUI() {
  const km = state.radiusKm;
  const group = document.querySelector('.mt-radius');
  if (group) group.hidden = !state.selectedPlaceId;
  document.querySelectorAll('.mt-radius [data-radius]').forEach(b =>
    b.setAttribute('aria-checked', String(parseFloat(b.dataset.radius) === km)));
  const legend = document.getElementById('map-radius-legend');
  if (!legend) return;
  legend.hidden = !(state.selectedPlaceId && km);
  if (legend.hidden) return;
  const n = countInRadius(km);
  document.getElementById('mrl-km').textContent = km < 1 ? '500 m' : `${km} km`;
  document.getElementById('mrl-n').textContent = `${fmt(n)} ${n === 1 ? 'ponto visível' : 'pontos visíveis'}`;
}

/* ── Selection ─────────────────────────────────── */
export function selectEstablishment(placeId) {
  if (!map) return;
  const el = map.getContainer();
  _clearRadius();
  if (selMarker) { map.removeLayer(selMarker); selMarker = null; }
  el.classList.toggle('has-selection', !!placeId);
  _updateState();
  _syncRadiusUI();

  if (!placeId) {
    _refresh();
    return;
  }
  const e = getByPlaceId(placeId);
  if (!e || !e.latitude) return;

  selMarker = L.marker([e.latitude, e.longitude], {
    icon: _selIcon(e), pane: 'selPane', interactive: false, keyboard: false,
  }).addTo(map);

  _refresh();
  const z = Math.max(map.getZoom(), UNCLUSTER_ZOOM + 0.5);
  pendingFit = false;
  if (!isVisible()) { map.setView([e.latitude, e.longitude], z, { animate: false }); return; }
  map.flyTo([e.latitude, e.longitude], z, { duration: dur(0.4) });

  // Bottom sheet no mobile cobre a metade inferior: sobe o ponto
  if (window.innerWidth <= 768) {
    map.once('moveend', () => map.panBy([0, Math.round(window.innerHeight * 0.22)], { duration: dur(0.25) }));
  }
}

/* ── Radius ────────────────────────────────────── */
export function updateRadius(km) {
  if (!map) return;
  _clearRadius();
  _syncRadiusUI();
  const e = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;
  if (!e || !km) return;

  map.getContainer().classList.add('has-radius');
  radiusCircle = L.circle([e.latitude, e.longitude], {
    radius: km * 1000,
    color: '#654078',
    weight: 1,
    opacity: 0.5,
    dashArray: '2 6',
    fillColor: '#7A3C8C',
    fillOpacity: 0.045,
    interactive: false,
    className: 'acai-radius',
  }).addTo(map);

  _markInRadius();
  if (isVisible()) map.flyToBounds(radiusCircle.getBounds(), { ...FIT_PAD, duration: dur(0.4) });
}

/** Estabelecimentos (com filtros atuais) dentro do raio, exceto o selecionado */
export function countInRadius(km) {
  const e = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;
  if (!e || !km) return 0;
  return getFiltered().filter(o => o.place_id !== e.place_id &&
    haversine(e.latitude, e.longitude, o.latitude, o.longitude) <= km).length;
}

function _markInRadius() {
  const e = state.selectedPlaceId ? getByPlaceId(state.selectedPlaceId) : null;
  const km = state.radiusKm;
  for (const m of markers.values()) {
    const o = m.__e;
    const want = !!(e && km && haversine(e.latitude, e.longitude, o.latitude, o.longitude) <= km);
    if (m.__inRadius !== want) { m.__inRadius = want; m.setIcon(_pinIcon(o, want)); }
  }
  _refresh();
}

function _clearRadius() {
  if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
  map.getContainer().classList.remove('has-radius');
  let changed = false;
  for (const m of markers.values()) {
    if (m.__inRadius) { m.__inRadius = false; m.setIcon(_pinIcon(m.__e, false)); changed = true; }
  }
  if (changed) _refresh();
}

/* ── Modes: pontos ↔ concentração ──────────────── */
export function setMode(mode) {
  if (!map) return;
  const el = map.getContainer();
  const heatOn = mode === 'heat';
  el.classList.toggle('mode-heat', heatOn);
  document.getElementById('map-legend')?.classList.toggle('is-heat', heatOn);
  document.querySelectorAll('.mt-seg [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));

  if (heatOn) {
    if (!heat) {
      heat = L.heatLayer([], {
        radius: 26, blur: 22, maxZoom: 15, minOpacity: 0.28,
        gradient: { 0.2: '#D9CCE0', 0.45: '#B79AC4', 0.65: '#7A3C8C', 0.85: '#4B255D', 1: '#A2CC24' },
      });
    }
    if (map.hasLayer(cluster)) map.removeLayer(cluster);
    if (!map.hasLayer(heat)) heat.addTo(map);
    // Só depois de estar no mapa: setLatLngs agenda redesenho e lê heat._map
    heat.setLatLngs(getFiltered().map(e => [e.latitude, e.longitude, 1]));
  } else {
    if (heat && map.hasLayer(heat)) {
      // leaflet-heat agenda um redesenho por frame; se rodar após a remoção, lê _map nulo
      if (heat._frame) { L.Util.cancelAnimFrame(heat._frame); heat._frame = null; }
      map.removeLayer(heat);
    }
    if (!map.hasLayer(cluster)) { map.addLayer(cluster); _refresh(); }
  }
}

function _bindToolbar() {
  document.getElementById('mt-belem')?.addEventListener('click', recenter);
  document.getElementById('mt-all')?.addEventListener('click', () => dispatch('RESET_ALL'));
  document.querySelectorAll('.mt-seg [data-mode]').forEach(btn => {
    btn.addEventListener('click', () => dispatch('SET_MAP_MODE', { mode: btn.dataset.mode }));
  });
  document.querySelectorAll('.mt-radius [data-radius]').forEach(btn => {
    btn.addEventListener('click', () => {
      const km = parseFloat(btn.dataset.radius);
      dispatch('SET_RADIUS', { km: state.radiusKm === km ? null : km });
    });
  });
}

export function syncOverlays() { _updateState(); _syncRadiusUI(); }

export function invalidate() {
  if (!map) return;
  map.invalidateSize();
  if (pendingFit && isVisible()) fitTo();
}
