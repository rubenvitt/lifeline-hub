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
}

/**
 * Aktiviert Polygon- oder Linien-Zeichnen; ruft `onFertig` mit der gezeichneten Geometry auf.
 * Persistenz übernimmt die App; das Roh-Feature wird nach `finish` entfernt.
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
    // Roh-Feature aufräumen; Persistenz übernimmt die App.
    draw.removeFeatures(
      draw
        .getSnapshot()
        .map((x) => x.id)
        .filter((i): i is NonNullable<typeof i> => i != null),
    );
  });
  return {
    starten: (modus) => {
      if (!draw.enabled) draw.start();
      draw.setMode(MODUS_NAME[modus]);
    },
    stoppen: () => {
      if (draw.enabled) draw.stop();
    },
    zerstoeren: () => {
      if (draw.enabled) draw.stop();
    },
  };
}
