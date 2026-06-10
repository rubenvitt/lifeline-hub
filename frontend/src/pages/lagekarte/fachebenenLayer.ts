import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import type { FachebeneDef } from './fachebenen';
import type { FeatureCollection, FachebeneQuelle } from '../../api/fachebenen';

export const fachebeneSourceId = (key: string) => `fachebene-${key}`;

/** Idempotent: Source + (Polygon: fill/line | Punkt: circle)-Layer je Fachebene. */
export function sorgeFuerFachebeneLayer(map: MapLibreMap, def: FachebeneDef, daten: FeatureCollection) {
  const src = fachebeneSourceId(def.key);
  if (!map.getSource(src)) {
    map.addSource(src, { type: 'geojson', data: daten as never });
  }
  if (def.geometrieTyp === 'polygon') {
    if (!map.getLayer(`fachebene-${def.key}-fill`)) {
      map.addLayer({
        id: `fachebene-${def.key}-fill`,
        type: 'fill',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': def.farbe, 'fill-opacity': 0.2 },
      });
    }
    if (!map.getLayer(`fachebene-${def.key}-line`)) {
      map.addLayer({
        id: `fachebene-${def.key}-line`,
        type: 'line',
        source: src,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'line-color': def.farbe, 'line-width': 1.5 },
      });
    }
  } else {
    if (!map.getLayer(`fachebene-${def.key}-circle`)) {
      map.addLayer({
        id: `fachebene-${def.key}-circle`,
        type: 'circle',
        source: src,
        paint: {
          'circle-radius': 5,
          'circle-color': def.farbe,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
        },
      });
    }
  }
}

const layerIds = (key: FachebeneQuelle) => [
  `fachebene-${key}-fill`,
  `fachebene-${key}-line`,
  `fachebene-${key}-circle`,
];

/** Entfernt alle Layer + Source einer Fachebene (idempotent). */
export function entferneFachebeneLayer(map: MapLibreMap, key: FachebeneQuelle) {
  for (const id of layerIds(key)) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  const src = fachebeneSourceId(key);
  if (map.getSource(src)) map.removeSource(src);
}

/** Daten einer bestehenden Fachebene-Source aktualisieren. */
export function setzeFachebeneDaten(map: MapLibreMap, key: FachebeneQuelle, daten: FeatureCollection) {
  const s = map.getSource(fachebeneSourceId(key)) as GeoJSONSource | undefined;
  if (s) s.setData(daten as never);
}

/** Der anklickbare Layer einer Fachebene (Polygon → Fläche, Punkt → Kreis). */
export function fachebeneClickLayerId(def: FachebeneDef): string {
  return def.geometrieTyp === 'polygon' ? `fachebene-${def.key}-fill` : `fachebene-${def.key}-circle`;
}

const KATEGORIE_LABEL: Record<string, string> = {
  krankenhaus: 'Krankenhaus',
  pflege: 'Pflegeeinrichtung',
  schule: 'Schule / Kita',
  wasser: 'Wasserversorgung',
  strom: 'Umspannwerk',
  feuerwehr: 'Feuerwehr',
  polizei: 'Polizei',
  kritis: 'KRITIS-Objekt',
  warnung: 'Amtliche Warnung',
  pegel: 'Pegel',
};

/** Lesbares Label für eine normalisierte Kategorie (Fallback: Rohwert). */
export function kategorieLabel(kategorie: string): string {
  return KATEGORIE_LABEL[kategorie] ?? kategorie;
}

/**
 * Baut den Popup-Inhalt für ein angeklicktes Fachebenen-Feature aus dessen Properties.
 * Robust gegenüber Quell-Unterschieden (NINA: titel/schwere, Pegel: wert/einheit,
 * DWD-Passthrough: HEADLINE/EVENT, KRITIS: titel/kategorie). XSS-sicher via textContent.
 */
export function baueFachebenePopupInhalt(props: Record<string, unknown> | null | undefined): HTMLElement {
  const p = props ?? {};
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;

  const wrap = document.createElement('div');
  wrap.style.maxWidth = '240px';

  const titel =
    str(p.titel) ?? str(p.HEADLINE) ?? str(p.headline) ?? str(p.EVENT) ?? str(p.event) ??
    str(p.NAME) ?? str(p.name) ?? 'Objekt';
  const titelEl = document.createElement('strong');
  titelEl.textContent = titel;
  wrap.appendChild(titelEl);

  const zeilen: string[] = [];
  const kategorie = str(p.kategorie);
  if (kategorie) zeilen.push(kategorieLabel(kategorie));
  const schwere = str(p.schwere) ?? str(p.SEVERITY) ?? str(p.severity);
  if (schwere) zeilen.push(`Schwere: ${schwere}`);
  if (p.wert != null && p.wert !== false) {
    const einheit = str(p.einheit);
    zeilen.push(`Wasserstand: ${str(p.wert)}${einheit ? ` ${einheit}` : ''}`);
  }
  const beschreibung = str(p.DESCRIPTION) ?? str(p.description) ?? str(p.beschreibung);
  if (beschreibung) zeilen.push(beschreibung.length > 220 ? `${beschreibung.slice(0, 220)}…` : beschreibung);

  for (const z of zeilen) {
    const el = document.createElement('div');
    el.style.fontSize = '12px';
    el.style.marginTop = '2px';
    el.textContent = z;
    wrap.appendChild(el);
  }
  return wrap;
}
