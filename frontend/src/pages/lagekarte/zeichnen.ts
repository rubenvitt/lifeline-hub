import type { Map as MapLibreMap } from 'maplibre-gl';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { GeoJsonGeometry } from './geo';

export type ZeichenModus = 'polygon' | 'linie';

/** App-Modus → terra-draw-Modusname (terra-draw 1.31.0). */
const MODUS_NAME: Record<ZeichenModus, string> = { polygon: 'polygon', linie: 'linestring' };

export interface Zeichnung {
  starten: (modus: ZeichenModus) => void;
  stoppen: () => void;
  zerstoeren: () => void;
  /** Native Finish-Geste auslösen; false bei zu wenigen Punkten oder wenn terra-draw nicht abschloss. */
  abschliessen: () => boolean;
}

/**
 * Aktiviert Polygon- oder Linien-Zeichnen; ruft `onFertig` mit der gezeichneten Geometry auf.
 * Persistenz übernimmt die App; das Roh-Feature bleibt sichtbar, bis `stoppen()` es räumt.
 */
export function createZeichnung(
  map: MapLibreMap,
  onFertig: (geometrie: GeoJsonGeometry) => void,
  onBereitschaftAendern: (bereit: boolean) => void = () => {},
): Zeichnung {
  // Hinweis: terra-draw-maplibre-gl-adapter@1.x nimmt KEIN `lib` — er importiert maplibre-gl gar
  // nicht, sondern duck-typed gegen die übergebene Map-Instanz (sein einziger maplibre-Import ist
  // type-only, und er fasst das Event-System der Map nie an; seine Listener hängen am Canvas-DOM).
  // Daher der lose Peer-Range `>=4`, daher kein Dual-Instance-Risiko — und daher überstand er den
  // Sprung auf maplibre 6 unverändert.
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode()],
  });
  const canvas = map.getCanvas();
  let aktiv = false;
  let aktiverModus: ZeichenModus | null = null;
  const gesetztePunkte = new Set<string>();
  let fertigZaehler = 0;

  const mindestPunkte = () => aktiverModus === 'linie' ? 2 : 3;

  // TerraDraw veröffentlicht keine Anzahl der FEST gesetzten Punkte. Der Snapshot enthält
  // während des Zeichnens zusätzlich den beweglichen Vorschaupunkt und wäre deshalb schon
  // vor dem dritten Klick scheinbar vollständig. Gezählt werden stattdessen die wirklichen
  // Canvas-Klicks des aktiven Zeichenmodus.
  const punktGesetzt = (event: MouseEvent) => {
    if (!aktiv) return;
    // Ein Doppelklick erzeugt zwei `click`-Events an derselben Pixelposition. Ohne die
    // Entdoppelung würden zwei wirkliche Punkte als drei zählen und den Knopf zu früh
    // freigeben. Derselbe Pixel ist auch fachlich kein zusätzlicher Polygonpunkt.
    gesetztePunkte.add(`${event.clientX}:${event.clientY}`);
    onBereitschaftAendern(gesetztePunkte.size >= mindestPunkte());
  };
  canvas.addEventListener('click', punktGesetzt, true);

  const zuruecksetzen = () => {
    aktiv = false;
    aktiverModus = null;
    gesetztePunkte.clear();
    onBereitschaftAendern(false);
  };

  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw') return;
    fertigZaehler += 1;
    aktiv = false;
    onBereitschaftAendern(false);
    const f = draw.getSnapshot().find((x) => x.id === id);
    if (f && f.geometry.type === 'Polygon') {
      onFertig({ type: 'Polygon', coordinates: f.geometry.coordinates as number[][][] });
    } else if (f && f.geometry.type === 'LineString') {
      onFertig({ type: 'LineString', coordinates: f.geometry.coordinates as number[][] });
    }
    // Kein sofortiges removeFeatures mehr: der abgeschlossene Entwurf bleibt sichtbar, bis
    // die App das Zeichnen beendet (`stoppen()` räumt via `draw.clear()` auf) — nötig, damit
    // die Speicher-Bestätigung die Geometrie zeigt (LFH-145).
  });
  return {
    starten: (modus) => {
      if (!draw.enabled) draw.start();
      // Beim Re-Aktivieren/Moduswechsel einen evtl. noch offenen oder abgeschlossen-aber-
      // unbestätigten Entwurf verwerfen (das Cleanup ist bewusst bis hierher aufgeschoben).
      else draw.clear();
      draw.setMode(MODUS_NAME[modus]);
      gesetztePunkte.clear();
      aktiverModus = modus;
      aktiv = true;
      onBereitschaftAendern(false);
    },
    stoppen: () => {
      if (draw.enabled) {
        // Entwurf (in-progress ODER abgeschlossen-aber-unbestätigt) verwerfen, dann stoppen.
        draw.clear();
        draw.stop();
      }
      zuruecksetzen();
    },
    zerstoeren: () => {
      if (draw.enabled) draw.stop();
      canvas.removeEventListener('click', punktGesetzt, true);
      zuruecksetzen();
    },
    abschliessen: () => {
      if (!aktiv || gesetztePunkte.size < mindestPunkte()) return false;
      // terra-draw hat keine öffentliche finish()-API. Der native Abschluss läuft über die
      // Finish-Taste (default 'Enter'); terra-draw registriert seine Key-Listener auf dem
      // Karten-Canvas. Der Event-Zähler belegt zusätzlich, ob die synchrone Geste wirklich
      // ein finish-Event erzeugt hat.
      const vorher = fertigZaehler;
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return fertigZaehler > vorher;
    },
  };
}
