import type { Map as MapLibreMap } from 'maplibre-gl';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { MessForm, MessGeometrie } from './messung';

/** App-Form → terra-draw-Modusname. */
const MODUS_NAME: Record<MessForm, string> = { strecke: 'linestring', flaeche: 'polygon' };
/** App-Form → GeoJSON-Typ der Figur, die terra-draw in diesem Modus zeichnet. */
const GEOMETRIE: Record<MessForm, string> = { strecke: 'LineString', flaeche: 'Polygon' };

export interface MessZeichnung {
  starten: (form: MessForm) => void;
  stoppen: () => void;
  zerstoeren: () => void;
  /** Schließt die laufende Messung ab (Enter-Geste); false, solange zu wenige Punkte stehen. */
  abschliessen: () => boolean;
}

/**
 * Zeichnung fürs Messwerkzeug (LFH-616) — eigener terra-draw-Controller neben den beiden aus
 * `zeichnen.ts`, aus zwei Gründen, die dort nicht passen:
 *
 * 1. **Der Wert läuft mit.** Zeichnen meldet erst beim Abschluss, Messen bei JEDER Änderung
 *    (`change`) — samt dem beweglichen Vorschaupunkt unter dem Zeiger. Genau das ist hier
 *    gewollt: die Strecke bis zum Zeiger ist die Frage, die man beim Messen stellt.
 * 2. **Es steht höchstens EINE Messung da.** terra-draw bleibt nach dem Abschluss im Modus,
 *    der nächste Klick beginnt eine neue Figur. Die abgeschlossene wird dann entfernt, statt
 *    sich zu stapeln — eine Messung ist ein Blick, kein Lagebild-Objekt, und nichts davon
 *    wird gespeichert.
 *
 * terra-draw verwaltet seine Layer selbst über den Adapter, eine Re-Anlage nach `setStyle`
 * (Poller in `kartenLayer.ts`) braucht es deshalb nicht.
 */
export function createMessung(
  map: MapLibreMap,
  onMessung: (g: MessGeometrie | null, fertig: boolean) => void,
): MessZeichnung {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode()],
  });
  const canvas = map.getCanvas();
  let laufend: string | number | null = null;
  let fertig: string | number | null = null;
  let aktiv = false;
  let form: MessForm = 'strecke';
  /** Eigenes Entfernen löst selbst `change` aus — das darf keine Meldung erzeugen. */
  let raeumt = false;

  const geometrie = (id: string | number): MessGeometrie | null => {
    const f = draw.getSnapshotFeature(id);
    return f ? { type: f.geometry.type, coordinates: f.geometry.coordinates } : null;
  };

  const punkteZahl = (g: MessGeometrie | null): number => {
    if (!g) return 0;
    const punkte = (
      g.type === 'Polygon' ? (g.coordinates as number[][][])[0] : g.coordinates
    ) as number[][];
    return new Set(punkte.map(([x, y]) => `${x}:${y}`)).size;
  };

  draw.on('change', (ids, typ) => {
    if (raeumt || !aktiv) return;
    // terra-draw legt neben der Figur eigene Hilfspunkte an (Schließ- und Stützpunkte, Typ
    // `Point`) und meldet sie ebenfalls als `create`. Laufende Messung ist nur die Figur der
    // gewählten Form — ein Hilfspunkt als „laufend" ließe den Wert auf „—" stehen.
    const figur =
      typ === 'create' ? ids.find((id) => geometrie(id)?.type === GEOMETRIE[form]) : undefined;
    if (figur != null) {
      laufend = figur;
      if (fertig != null) {
        raeumt = true;
        draw.removeFeatures([fertig]);
        raeumt = false;
        fertig = null;
      }
    }
    if (laufend == null || !ids.includes(laufend)) return;
    if (typ === 'delete') {
      // Escape auf dem Canvas verwirft den Entwurf (terra-draw-Vorgabe).
      laufend = null;
      onMessung(null, false);
      return;
    }
    onMessung(geometrie(laufend), false);
  });

  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw' || !aktiv) return;
    fertig = id;
    laufend = null;
    onMessung(geometrie(id), true);
  });

  const leeren = () => {
    laufend = null;
    fertig = null;
    onMessung(null, false);
  };

  return {
    starten: (neu) => {
      raeumt = true;
      if (!draw.enabled) draw.start();
      else draw.clear();
      raeumt = false;
      draw.setMode(MODUS_NAME[neu]);
      form = neu;
      aktiv = true;
      leeren();
    },
    stoppen: () => {
      aktiv = false;
      if (draw.enabled) {
        draw.clear();
        draw.stop();
      }
      leeren();
    },
    zerstoeren: () => {
      aktiv = false;
      if (draw.enabled) draw.stop();
    },
    abschliessen: () => {
      if (!aktiv || laufend == null) return false;
      // Der laufende Entwurf enthält den Vorschaupunkt unter dem Zeiger; auf dem Touchschirm
      // gibt es keinen, dort liegt er auf dem letzten Punkt und zählt nicht doppelt.
      if (punkteZahl(geometrie(laufend)) < (form === 'strecke' ? 2 : 3)) return false;
      // Keine öffentliche finish()-API — dieselbe Geste wie in `zeichnen.ts`.
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return fertig != null;
    },
  };
}
