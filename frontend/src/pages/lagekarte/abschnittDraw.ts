import maplibregl from 'maplibre-gl';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { GeoJsonPolygon } from './geo';

export interface AbschnittDraw {
  starten: () => void;
  stoppen: () => void;
  zerstoeren: () => void;
}

/** Aktiviert den Polygon-Zeichenmodus; ruft `onFertig` mit dem gezeichneten Polygon auf. */
export function createAbschnittDraw(
  map: maplibregl.Map,
  onFertig: (polygon: GeoJsonPolygon) => void,
): AbschnittDraw {
  // Hinweis: terra-draw-maplibre-gl-adapter@1.4 nimmt KEIN `lib` (anders als die generische
  // Verified-API-Notiz); der Adapter bindet MapLibre intern.
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [new TerraDrawPolygonMode()],
  });
  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw') return;
    const f = draw.getSnapshot().find((x) => x.id === id);
    if (f && f.geometry.type === 'Polygon') {
      onFertig({ type: 'Polygon', coordinates: f.geometry.coordinates as number[][][] });
    }
    // Roh-Feature aufräumen; Persistenz übernimmt die App.
    draw.removeFeatures(draw.getSnapshot().map((x) => x.id).filter((id): id is NonNullable<typeof id> => id != null));
  });
  return {
    starten: () => { if (!draw.enabled) draw.start(); draw.setMode('polygon'); },
    stoppen: () => { if (draw.enabled) draw.stop(); },
    zerstoeren: () => { if (draw.enabled) draw.stop(); },
  };
}
