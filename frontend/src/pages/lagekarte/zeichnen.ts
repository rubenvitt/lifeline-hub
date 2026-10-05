import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawModeUndoRedo,
  TerraDrawPolygonMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { GeoJsonGeometry } from './geo';

export type ZeichenModus = 'polygon' | 'linie';

/** App-Modus → terra-draw-Modusname (terra-draw 1.31.0). */
const MODUS_NAME: Record<ZeichenModus, string> = { polygon: 'polygon', linie: 'linestring' };

/**
 * Stand der laufenden Figur. Ein Wert, aus dem „Abschließen", „Letzten Punkt zurück" und der
 * Punktzähler gelesen werden — zwei Meldewege für denselben Zustand ließen Zähler und Knopf
 * auseinanderlaufen.
 */
export interface ZeichenStand {
  /** Fest gesetzte Punkte der laufenden Figur, wie terra-draw sie hält. */
  punkte: number;
  /** Mindestzahl erreicht (Linie 2, Fläche 3) — „Abschließen" ist frei. */
  bereit: boolean;
  /** Es gibt einen Punkt, den „Letzten Punkt zurück" nehmen kann. */
  kannZurueck: boolean;
}

export const LEERER_ZEICHENSTAND: ZeichenStand = { punkte: 0, bereit: false, kannZurueck: false };

export interface Zeichnung {
  starten: (modus: ZeichenModus) => void;
  stoppen: () => void;
  zerstoeren: () => void;
  /** Native Finish-Geste auslösen; false bei zu wenigen Punkten oder wenn terra-draw nicht abschloss. */
  abschliessen: () => boolean;
  /** Zuletzt gesetzten Punkt zurücknehmen; false, wenn es nichts zurückzunehmen gibt. */
  punktZurueck: () => boolean;
  /**
   * Angefangene Figur verwerfen und im selben Modus weiterzeichnen (erste Esc-Stufe). Außerhalb des
   * Zeichnens wirkungslos.
   */
  verwerfen: () => void;
}

/**
 * Aktiviert Polygon- oder Linien-Zeichnen; ruft `onFertig` mit der gezeichneten Geometry auf.
 * Persistenz übernimmt die App; das Roh-Feature bleibt sichtbar, bis `stoppen()` es räumt.
 */
export function createZeichnung(
  map: MapLibreMap,
  onFertig: (geometrie: GeoJsonGeometry) => void,
  onStandAendern: (stand: ZeichenStand) => void = () => {},
  /**
   * Präfix der Sources/Layer, die der Adapter anlegt. Auf einer Karte leben drei
   * terra-draw-Instanzen (Abschnitt, Zone, Messen); mit gemeinsamem Präfix legte die zweite
   * `td-polygon` an, solange die erste es hielt, und MapLibre warf „Source … already exists". Jede
   * Instanz trägt deshalb ihren eigenen.
   */
  praefix = 'td-zeichnen',
): Zeichnung {
  // Esc gehört der Seite, nicht terra-draw (LFH-712): genau ein Ort entscheidet, was die Taste beim
  // Zeichnen tut. terra-draw bricht per Vorgabe auf `keyup` am Canvas ab, also nur mit Fokus auf
  // der Karte und still; die Option verhindert, dass es verwirft, wo die Seite die Taste bewusst
  // liegen lässt. `finish` bleibt Enter: `abschliessen()` löst den Abschluss über diese Taste aus.
  // (`messZeichnung.ts` behält das terra-draw-Esc: dort endet ein Blick, kein Entwurf.)
  const keyEvents = { cancel: null, finish: 'Enter' };
  // terra-draw-maplibre-gl-adapter@1.x nimmt kein `lib`: er duck-typed gegen die übergebene
  // Map-Instanz (sein maplibre-Import ist type-only, seine Listener hängen am Canvas-DOM). Daher
  // der lose Peer-Range `>=4` und kein Dual-Instance-Risiko.
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: praefix }),
    modes: [new TerraDrawPolygonMode({ keyEvents }), new TerraDrawLineStringMode({ keyEvents })],
    // Ohne `modeLevel` legt TerraDraw keinen Undo-Koordinator an, und `undo()` liefert konstant
    // false — „Letzten Punkt zurück" wäre still tot, deshalb prüft der Test die Option am
    // Konstruktor. `keyboardShortcuts` bleibt weg: der Knopf ist der Weg.
    undoRedo: { modeLevel: new TerraDrawModeUndoRedo() },
  });
  const canvas = map.getCanvas();
  let aktiv = false;
  let aktiverModus: ZeichenModus | null = null;
  let punkte = 0;
  let fertigZaehler = 0;
  let gemeldet: ZeichenStand | null = null;

  const mindestPunkte = () => (aktiverModus === 'linie' ? 2 : 3);

  const melde = () => {
    const n = aktiv ? punkte : 0;
    const stand: ZeichenStand = { punkte: n, bereit: n >= mindestPunkte(), kannZurueck: n > 0 };
    if (
      gemeldet &&
      gemeldet.punkte === stand.punkte &&
      gemeldet.bereit === stand.bereit &&
      gemeldet.kannZurueck === stand.kannZurueck
    )
      return;
    gemeldet = stand;
    onStandAendern(stand);
  };

  // Die Punktzahl kommt aus terra-draw selbst: jeder fest gesetzte Punkt liegt auf dem Undo-Stapel
  // des Modus, `history` meldet dessen Größe, auch beim Zurücknehmen. DOM-Klicks taugen nicht:
  // terra-draw setzt auf `pointerup` mit eigenen Ziehschwellen, MapLibre unterdrückt den Klick ab 3
  // px — ein Mikro-Ziehen ergab „1 Punkt" für eine leere Figur. Der Snapshot taugt auch nicht: er
  // enthält den beweglichen Vorschaupunkt.
  draw.on('history', (e) => {
    if (!aktiv || e.stack !== 'mode') return;
    punkte = e.undoSize;
    melde();
  });

  const zuruecksetzen = () => {
    aktiv = false;
    aktiverModus = null;
    punkte = 0;
    melde();
  };

  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw') return;
    fertigZaehler += 1;
    aktiv = false;
    melde();
    const f = draw.getSnapshot().find((x) => x.id === id);
    if (f && f.geometry.type === 'Polygon') {
      onFertig({ type: 'Polygon', coordinates: f.geometry.coordinates as number[][][] });
    } else if (f && f.geometry.type === 'LineString') {
      onFertig({ type: 'LineString', coordinates: f.geometry.coordinates as number[][] });
    }
    // Der abgeschlossene Entwurf bleibt sichtbar, bis die App das Zeichnen beendet (`stoppen()`
    // räumt via `draw.clear()`), damit die Speicher-Bestätigung die Geometrie zeigt.
  });
  return {
    starten: (modus) => {
      if (!draw.enabled) draw.start();
      // Beim Re-Aktivieren/Moduswechsel einen evtl. noch offenen oder abgeschlossen-aber-
      // unbestätigten Entwurf verwerfen (das Cleanup ist bewusst bis hierher aufgeschoben).
      else draw.clear();
      draw.setMode(MODUS_NAME[modus]);
      punkte = 0;
      aktiverModus = modus;
      aktiv = true;
      melde();
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
      // Abbau ist der letzte Schritt: wirft terra-draw, weil die Karte schon entfernt ist, läuft
      // der übrige Abbau trotzdem (`lagekarte/AGENTS.md`, „Zeichnen und Messen“, LFH-943).
      try {
        if (draw.enabled) draw.stop();
      } catch {
        /* Karte schon entfernt */
      } finally {
        zuruecksetzen();
      }
    },
    abschliessen: () => {
      if (!aktiv || punkte < mindestPunkte()) return false;
      // terra-draw hat keine öffentliche finish()-API; der Abschluss läuft über die Finish-Taste
      // (Enter), deren Listener am Karten-Canvas hängen. Der Event-Zähler belegt, ob die synchrone
      // Geste wirklich ein finish-Event erzeugt hat.
      const vorher = fertigZaehler;
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return fertigZaehler > vorher;
    },
    punktZurueck: () => {
      // `undo()` wirft bei gestopptem TerraDraw ("Terra Draw is not enabled"), statt false zu
      // liefern — deshalb der `enabled`-Riegel. Ohne eigenen Punkt wird terra-draw gar nicht
      // gefragt.
      if (!aktiv || !draw.enabled || punkte === 0) return false;
      const vorher = punkte;
      if (!draw.undo()) return false;
      // `history` meldet den neuen Stand meist synchron aus `undo()`. Bleibt die Meldung aus, wird
      // nachgezogen, damit der Knopf nicht auf dem alten Stand stehen bleibt.
      if (punkte === vorher) punkte = vorher - 1;
      melde();
      return true;
    },
    verwerfen: () => {
      if (!aktiv || !draw.enabled || aktiverModus == null) return;
      // Dieselbe Folge wie beim Re-Aktivieren in `starten`: Entwurf weg, Modus neu setzen.
      draw.clear();
      draw.setMode(MODUS_NAME[aktiverModus]);
      punkte = 0;
      melde();
    },
  };
}
