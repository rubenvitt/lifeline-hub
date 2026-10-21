/**
 * Karte der punktweisen Bearbeitung (LLH-1344, design.md D2): Vorschau der bearbeiteten Figur und
 * die Griffe an Ecken und Kantenmitten. Ohne terra-draw: dessen Auswahlmodus entfernt Punkte nur
 * per Rechtsklick und zeigt an jeder Kante einen Zwischenpunkt — bei einem Kreis mit 64 Ecken
 * unbedienbar, mit Handschuh gar nicht.
 *
 * Die Ebenen tragen den Präfix `td-` wie jede Zeichnung (die Eigenposition legt sich darunter,
 * LFH-766) und sind keine Klickebene (keine Rolle in `ordneKlickebene`). Die Griffe sind
 * `maplibregl.Marker` wie Kreis- und Bildgriffe (Ziel `max(controlHeight, 44)`); ein Zug meldet
 * erst am Ende eine Aktion, dazwischen zieht die Vorschau hier selbst mit.
 */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { GeoJsonGeometry } from './geo';
import { griffKante, griffStil, type GriffKontext } from './bildGriffe';
import {
  eckenJeRing,
  sichtbareGriffe,
  wendeAn,
  starteBearbeitung,
  zwischenpunkte,
  type BearbeitungsAktion,
  type Lage,
  type PunktRef,
} from './zonenBearbeitung';

export const BEARBEITEN_QUELLE = 'td-zone-bearbeiten';
export const BEARBEITEN_LAYER = ['td-zone-bearbeiten-flaeche', 'td-zone-bearbeiten-linie'] as const;

/** Was die Karte zeigt: die laufende Figur, der gewählte Punkt, die Farbe der Zone. */
export interface BearbeitungsVorschau {
  geometrie: GeoJsonGeometry;
  gewaehlt: PunktRef | null;
  farbe: string;
}

/** Die Figur als FeatureCollection der Vorschau. Rein. */
export function bearbeitungsDaten(g: GeoJsonGeometry | null) {
  return {
    type: 'FeatureCollection' as const,
    features: g ? [{ type: 'Feature' as const, properties: {}, geometry: g }] : [],
  };
}

/**
 * Quelle und Ebenen idempotent anlegen und die Figur einspielen; ohne Figur und ohne Quelle bleibt
 * die Karte unberührt. Gestrichelt wie jeder Entwurf: gespeichert ist noch nichts.
 */
export function sorgeFuerBearbeitungsVorschau(
  map: MapLibreMap,
  v: Pick<BearbeitungsVorschau, 'geometrie' | 'farbe'> | null,
): void {
  const daten = bearbeitungsDaten(v?.geometrie ?? null);
  const quelle = map.getSource(BEARBEITEN_QUELLE) as GeoJSONSource | undefined;
  if (!quelle && daten.features.length === 0) return;
  if (quelle) quelle.setData(daten as never);
  else map.addSource(BEARBEITEN_QUELLE, { type: 'geojson', data: daten as never });
  const farbe = v?.farbe ?? '#000';
  if (!map.getLayer('td-zone-bearbeiten-flaeche')) {
    map.addLayer({
      id: 'td-zone-bearbeiten-flaeche',
      type: 'fill',
      source: BEARBEITEN_QUELLE,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': farbe, 'fill-opacity': 0.15 },
    } as never);
  } else map.setPaintProperty('td-zone-bearbeiten-flaeche', 'fill-color', farbe);
  if (!map.getLayer('td-zone-bearbeiten-linie')) {
    map.addLayer({
      id: 'td-zone-bearbeiten-linie',
      type: 'line',
      source: BEARBEITEN_QUELLE,
      paint: { 'line-color': farbe, 'line-width': 3, 'line-dasharray': [2, 1] },
    } as never);
  } else map.setPaintProperty('td-zone-bearbeiten-linie', 'line-color', farbe);
}

/** Ebenen und Quelle entfernen (Modusende). */
export function entferneBearbeitungsVorschau(map: MapLibreMap): void {
  for (const id of BEARBEITEN_LAYER) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(BEARBEITEN_QUELLE)) map.removeSource(BEARBEITEN_QUELLE);
}

/**
 * Nach einem Zug folgt auf manchen Geräten noch ein `click` auf dem Griff. Er darf weder wählen
 * noch einen zweiten Punkt einfügen: Klicks so kurz nach dem Zug zählen nicht.
 */
const NACHKLICK_MS = 500;

export interface BearbeitungsGriffe {
  /** Figur und Wahl nachführen; `null` räumt Griffe und Vorschau. */
  setze(v: BearbeitungsVorschau | null): void;
  zerstoeren(): void;
}

/**
 * Die Griffe (design.md D2): Eckgriff (`eck`) ziehen = verschieben, tippen = wählen;
 * Zwischengriff (`kante`, rund) tippen = Punkt auf der Kantenmitte, ziehen = Punkt an der
 * Ablagestelle. Gedrängte Griffe stehen nicht (`sichtbareGriffe`), neu nach jedem Zoom.
 */
export function erzeugeBearbeitungsGriffe(
  map: MapLibreMap,
  kontext: GriffKontext,
  melde: (a: BearbeitungsAktion) => void,
): BearbeitungsGriffe {
  let v: BearbeitungsVorschau | null = null;
  let marker: maplibregl.Marker[] = [];
  let ziehend = false;
  let gezogenAm = 0;
  let aufbauAnstehend = false;

  const element = (art: 'eck' | 'kante', kennung: string, gewaehlt: boolean) => {
    const { container, kern } = griffStil(art, kontext);
    const el = document.createElement('div');
    el.style.cssText = container;
    el.dataset.lfh = kennung;
    el.setAttribute('aria-hidden', 'true');
    const innen = document.createElement('div');
    // Der gewählte Punkt ist gefüllt: Form und Fläche tragen die Wahl, nicht nur die Farbe.
    innen.style.cssText = gewaehlt
      ? kern.replace('background:#fff', `background:${kontext.bedien}`) + ';transform:scale(1.4)'
      : kern;
    el.appendChild(innen);
    return el;
  };

  /** Vorschau während des Zugs: die Figur mit der Aktion, ohne sie zu melden. */
  const ziehVorschau = (a: BearbeitungsAktion) => {
    if (!v) return;
    const s = wendeAn(starteBearbeitung(v.geometrie), a);
    sorgeFuerBearbeitungsVorschau(map, { geometrie: s.geometrie, farbe: v.farbe });
  };

  const lage = (m: maplibregl.Marker): Lage => {
    const ll = m.getLngLat();
    return [ll.lng, ll.lat];
  };

  const ziehbar = (
    el: HTMLElement,
    an: Lage,
    aktion: (l: Lage) => BearbeitungsAktion,
    tipp: () => BearbeitungsAktion,
  ) => {
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(an);
    el.addEventListener('click', (e) => {
      // Kein Tipp auf die Karte (der höbe die Wahl auf).
      e.stopPropagation();
      if (Date.now() - gezogenAm < NACHKLICK_MS) return;
      melde(tipp());
    });
    m.on('dragstart', () => {
      ziehend = true;
    });
    m.on('drag', () => ziehVorschau(aktion(lage(m))));
    m.on('dragend', () => {
      ziehend = false;
      gezogenAm = Date.now();
      melde(aktion(lage(m)));
      if (aufbauAnstehend) baueAuf();
    });
    m.addTo(map);
    marker.push(m);
  };

  function raeume() {
    for (const m of marker) m.remove();
    marker = [];
  }

  function baueAuf() {
    // Mitten im Zug bleibt der gezogene Griff stehen; aufgebaut wird nach dem Ende.
    if (ziehend) {
      aufbauAnstehend = true;
      return;
    }
    aufbauAnstehend = false;
    raeume();
    if (!v) return;
    const g = v.geometrie;
    const ringe = eckenJeRing(g);
    const px = ringe.map((r) =>
      r.map((p) => {
        const q = map.project(p);
        return { x: q.x, y: q.y };
      }),
    );
    const sichtbar = sichtbareGriffe(px, g.type, griffKante(kontext.controlHeight), v.gewaehlt);
    // Zwischengriffe zuerst: die Eckgriffe liegen darüber.
    for (const z of zwischenpunkte(g)) {
      if (!sichtbar.kanten[z.ring]?.[z.nach]) continue;
      ziehbar(
        element('kante', 'zonengriff-zwischen', false),
        z.lage,
        (l) => ({ art: 'einfuegen', ring: z.ring, nach: z.nach, lage: l }),
        () => ({ art: 'einfuegen', ring: z.ring, nach: z.nach, lage: z.lage }),
      );
    }
    ringe.forEach((ring, r) =>
      ring.forEach((p, i) => {
        if (!sichtbar.ecken[r]?.[i]) return;
        const punkt = { ring: r, index: i };
        const gewaehlt = v?.gewaehlt?.ring === r && v.gewaehlt.index === i;
        ziehbar(
          element('eck', gewaehlt ? 'zonengriff-gewaehlt' : 'zonengriff', gewaehlt),
          p,
          (l) => ({ art: 'verschieben', punkt, lage: l }),
          () => ({ art: 'waehlen', punkt }),
        );
      }),
    );
  }

  const nachZoom = () => baueAuf();
  map.on('zoomend', nachZoom);

  return {
    setze(neu) {
      v = neu;
      sorgeFuerBearbeitungsVorschau(map, neu);
      baueAuf();
    },
    zerstoeren() {
      map.off('zoomend', nachZoom);
      ziehend = false;
      v = null;
      raeume();
    },
  };
}
