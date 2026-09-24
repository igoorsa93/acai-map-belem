/**
 * app.js - Application entry point
 */
import * as State from './state.js';
import * as MapModule from './map.js';
import * as Panel from './panel.js';
import * as Charts from './charts.js';
import * as KPIs from './kpis.js';
import * as Filters from './filters.js';
import * as Tables from './tables.js';
import * as Insights from './insights.js';
import * as Animations from './animations.js';
import * as Interactions from './interactions.js';
import { getGlobalStats, getCollectionDate } from './data.js';
import { fmt } from './utils.js';

function init() {
  _populateHero();
  Filters.render();
  KPIs.render();
  MapModule.init();
  Panel.render();
  Charts.init();
  Tables.render();
  Insights.render();
  Insights.renderBairros();
  Interactions.init();
  Interactions.updateNav(State.state.activeView);
  Animations.startCanvas();
  Animations.initReveal();

  State.subscribe(action => {
    const s = State.state;
    switch (action) {
      case 'SET_FILTER':
      case 'CLEAR_FILTERS':
        run(Filters.update, MapModule.updateMarkers, KPIs.render, Panel.render, Charts.updateAll, Tables.render, Insights.render);
        break;

      case 'RESET_ALL':
        run(Filters.update, () => MapModule.selectEstablishment(null), () => MapModule.setMode('points'),
          MapModule.updateMarkers, KPIs.render, Panel.render, Charts.updateAll, Tables.render, Insights.render);
        break;

      case 'SELECT_ESTABLISHMENT':
        run(() => MapModule.selectEstablishment(s.selectedPlaceId), Panel.render, KPIs.render, Charts.updateSelection, Tables.render);
        break;

      case 'SET_RADIUS':
        run(() => MapModule.updateRadius(s.radiusKm), Panel.updateRadiusUI);
        break;

      case 'SET_MAP_MODE':
        run(() => MapModule.setMode(s.mapMode));
        break;

      case 'SET_VIEW':
        run(() => Interactions.updateNav(s.activeView));
        window.scrollTo({ top: 0 });
        setTimeout(() => run(MapModule.invalidate, Charts.resize, Animations.refreshCanvas), 30);
        break;
    }
  });
}

/** Cada módulo atualiza isolado: uma falha não congela os demais */
function run(...fns) {
  for (const fn of fns) {
    try { fn(); } catch (err) { console.error('[açaí-map]', fn.name || 'update', err); }
  }
}

function _populateHero() {
  const g = getGlobalStats();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('hero-stat-estabs', fmt(g.total));
  set('hero-stat-bairros', fmt(g.bairros));
  set('hero-stat-queries', fmt(g.queries));
  set('hero-bairros-n', fmt(g.bairros));
  set('hero-date', getCollectionDate() ?? '—');
  set('sobre-total', fmt(g.total));
  set('sobre-bairros', fmt(g.bairros));
  set('sobre-queries', fmt(g.queries));
  set('sobre-occ', fmt(g.occurrencesTotal));
}

document.addEventListener('DOMContentLoaded', init);
