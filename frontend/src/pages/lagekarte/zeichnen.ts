import maplibregl from 'maplibre-gl';
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
  /** Native terra-draw-Finish-Geste (Enter) auslösen. terra-draw ignoriert zu wenige Punkte selbst. */
  abschliessen: () => void;
}

/**
 * Aktiviert Polygon- oder Linien-Zeichnen; ruft `onFertig` mit der gezeichneten Geometry auf.
 * Persistenz übernimmt die App; das Roh-Feature bleibt sichtbar, bis `stoppen()` es räumt.
 */
export function createZeichnung(
  map: maplibregl.Map,
  onFertig: (geometrie: GeoJsonGeometry) => void,
): Zeichnung {
  // Hinweis: terra-draw-maplibre-gl-adapter@1.x nimmt KEIN `lib`; der Adapter bindet MapLibre intern.
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode()],
  });
  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw') return;
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
    },
    stoppen: () => {
      if (draw.enabled) {
        // Entwurf (in-progress ODER abgeschlossen-aber-unbestätigt) verwerfen, dann stoppen.
        draw.clear();
        draw.stop();
      }
    },
    zerstoeren: () => {
      if (draw.enabled) draw.stop();
    },
    abschliessen: () => {
      // terra-draw hat keine öffentliche finish()-API. Der native Abschluss läuft über die
      // Finish-Taste (default 'Enter'); terra-draw registriert seine Key-Listener auf
      // map.getCanvas(). Wir feuern die Geste synthetisch. Zu wenige Punkte ignoriert
      // terra-draw selbst (kein finish-Event) — dann bleibt der Nutzer im Zeichnen-Modus.
      const el = map.getCanvas();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    },
  };
}
