/**
 * app.js - Application entry point
 */
import * as State from './state.js';
import * as MapModule from './map.js';
import * as Charts from './charts.js';
import * as KPIs from './kpis.js';
import * as Filters from './filters.js';
import * as Tables from './tables.js';
import * as Animations from './animations.js';
import * as Interactions from './interactions.js';
import { getGlobalStats } from './data.js';
import { fmt, fmtRating } from './utils.js';

function init() {
  // Init all modules
  Animations.startCanvas();
  Filters.render();
  KPIs.render();
  MapModule.init();
  Charts.init();
  Tables.render();
  Interactions.init();

  // Populate hero stats from real data
  _populateHero();

  // Entrance animations — after all cards are rendered
  requestAnimationFrame(() => requestAnimationFrame(() => Animations.initEntranceAnimations()));

  // Subscribe to state changes
  State.subscribe((action) => {
    switch (action) {
      case 'SET_FILTER':
      case 'CLEAR_FILTERS':
        Filters.renderChips();
        KPIs.render();
        MapModule.updateMarkers();
        Charts.updateAll();
        Tables.render();
        break;

      case 'SELECT_ESTABLISHMENT':
        MapModule.selectEstablishment(State.state.selectedPlaceId);
        KPIs.render();
        break;

      case 'SET_VIEW':
        Interactions.updateNav(State.state.activeView);
        if (State.state.activeView === 'mapa' || State.state.activeView === 'overview') {
          requestAnimationFrame(() => { requestAnimationFrame(() => MapModule.invalidate()); });
        }
        if (State.state.activeView === 'graficos') {
          requestAnimationFrame(() => Charts.updateAll());
        }
        break;

      case 'SET_RADIUS':
        MapModule.updateRadius(State.state.radiusKm);
        // Update radius button UI inside detail panel
        document.querySelectorAll('.radius-btn').forEach(btn => {
          btn.classList.toggle('active', parseFloat(btn.dataset.r) === State.state.radiusKm);
        });
        break;
    }
  });
}

function _populateHero() {
  const g = getGlobalStats();
  const vals = {
    'hero-stat-estabs': fmt(g.total),
    'hero-stat-bairros': fmt(g.bairros),
    'hero-stat-rating': fmtRating(g.avgRating),
    'hero-stat-reviews': fmt(g.totalRatings),
    'hero-stat-occs': fmt(g.occurrencesTotal),
    'hero-stat-queries': fmt(g.queries),
  };
  for (const [id, val] of Object.entries(vals)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

document.addEventListener('DOMContentLoaded', init);
