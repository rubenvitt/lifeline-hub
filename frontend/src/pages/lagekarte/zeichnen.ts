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
 * Stand der laufenden Figur (LFH-712). EIN Wert, aus dem „Abschließen", „Letzten Punkt zurück"
 * und der Punktzähler der Steuerung gelesen werden — zwei getrennte Meldewege für denselben
 * Zustand wären genau die Stelle, an der Zähler und Knopf auseinanderliefen.
 */
export interface ZeichenStand {
  /** Fest gesetzte, pixelverschiedene Punkte der laufenden Figur. */
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
   * Angefangene Figur verwerfen und im selben Modus weiterzeichnen (erste Esc-Stufe, LFH-712).
   * Außerhalb des Zeichnens wirkungslos.
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
   * Präfix der Sources/Layer, die der Adapter auf der Karte anlegt. Auf EINER Karte leben
   * drei terra-draw-Instanzen (Abschnitt, Zone, Messen); mit dem gemeinsamen Vorgabe-Präfix
   * „td" legte die zweite `td-polygon` an, solange die erste es noch hielt, und MapLibre warf
   * „Source … already exists" (gemessen im Browser, Review LFH-616). Jede Instanz trägt
   * deshalb ihren eigenen.
   */
  praefix = 'td-zeichnen',
): Zeichnung {
  // Esc gehört der Seite, nicht terra-draw (LFH-712, design.md D2). terra-draw bricht per
  // Vorgabe auf `keyup` AM CANVAS ab; ein Zuhörer der Seite liefe danach und sähe schon beim
  // ersten Esc eine leere Figur — das zweistufige Esc wäre einstufig. Und bei Fokus auf einem
  // Knopf der Steuerung erreichte die Taste den Canvas gar nicht. `finish` bleibt Enter:
  // `abschliessen()` löst den Abschluss über genau diese Taste aus.
  // (`messZeichnung.ts` behält das terra-draw-Esc bewusst — dort endet ein Blick, kein Entwurf.)
  const keyEvents = { cancel: null, finish: 'Enter' };
  // Hinweis: terra-draw-maplibre-gl-adapter@1.x nimmt KEIN `lib` — er importiert maplibre-gl gar
  // nicht, sondern duck-typed gegen die übergebene Map-Instanz (sein einziger maplibre-Import ist
  // type-only, und er fasst das Event-System der Map nie an; seine Listener hängen am Canvas-DOM).
  // Daher der lose Peer-Range `>=4`, daher kein Dual-Instance-Risiko — und daher überstand er den
  // Sprung auf maplibre 6 unverändert.
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: praefix }),
    modes: [new TerraDrawPolygonMode({ keyEvents }), new TerraDrawLineStringMode({ keyEvents })],
    // Ohne `modeLevel` legt TerraDraw seinen Undo-Koordinator gar nicht erst an und `undo()`
    // liefert KONSTANT false (LFH-344, im Bundle gemessen). „Letzten Punkt zurück" wäre tot,
    // ohne dass irgendetwas rot würde — deshalb prüft der Test die Option am Konstruktor.
    // `keyboardShortcuts` bleibt weg: Strg/⌘+Z ist nicht Teil von LFH-712, der Knopf ist der Weg.
    undoRedo: { modeLevel: new TerraDrawModeUndoRedo() },
  });
  const canvas = map.getCanvas();
  let aktiv = false;
  let aktiverModus: ZeichenModus | null = null;
  // Geordnete Reihe statt Set: beim Zurücknehmen muss der ZULETZT aufgenommene Eintrag wieder
  // verschwinden, und ein Set kennt keine Reihenfolge.
  const gesetztePunkte: string[] = [];
  let fertigZaehler = 0;
  let gemeldet: ZeichenStand | null = null;

  const mindestPunkte = () => (aktiverModus === 'linie' ? 2 : 3);

  // Die Freigabe von „zurück" folgt dem EIGENEN Zähler, nicht `draw.canUndo()`: der
  // Capture-Klick unten läuft, bevor terra-draw den Punkt verarbeitet — `canUndo()` wäre beim
  // ersten Punkt noch false und der Knopf bliebe eine Runde zu lange gesperrt.
  const melde = () => {
    const n = aktiv ? gesetztePunkte.length : 0;
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

  // TerraDraw veröffentlicht keine Anzahl der FEST gesetzten Punkte. Der Snapshot enthält
  // während des Zeichnens zusätzlich den beweglichen Vorschaupunkt und wäre deshalb schon
  // vor dem dritten Klick scheinbar vollständig. Gezählt werden stattdessen die wirklichen
  // Canvas-Klicks des aktiven Zeichenmodus.
  const punktGesetzt = (event: MouseEvent) => {
    if (!aktiv) return;
    // Ein Doppelklick erzeugt zwei `click`-Events an derselben Pixelposition. Ohne die
    // Entdoppelung würden zwei wirkliche Punkte als drei zählen und den Knopf zu früh
    // freigeben. Derselbe Pixel ist auch fachlich kein zusätzlicher Polygonpunkt.
    const schluessel = `${event.clientX}:${event.clientY}`;
    if (!gesetztePunkte.includes(schluessel)) gesetztePunkte.push(schluessel);
    melde();
  };
  canvas.addEventListener('click', punktGesetzt, true);

  const zuruecksetzen = () => {
    aktiv = false;
    aktiverModus = null;
    gesetztePunkte.length = 0;
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
      gesetztePunkte.length = 0;
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
      if (draw.enabled) draw.stop();
      canvas.removeEventListener('click', punktGesetzt, true);
      zuruecksetzen();
    },
    abschliessen: () => {
      if (!aktiv || gesetztePunkte.length < mindestPunkte()) return false;
      // terra-draw hat keine öffentliche finish()-API. Der native Abschluss läuft über die
      // Finish-Taste (default 'Enter'); terra-draw registriert seine Key-Listener auf dem
      // Karten-Canvas. Der Event-Zähler belegt zusätzlich, ob die synchrone Geste wirklich
      // ein finish-Event erzeugt hat.
      const vorher = fertigZaehler;
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return fertigZaehler > vorher;
    },
    punktZurueck: () => {
      // `undo()` WIRFT bei gestopptem TerraDraw ("Terra Draw is not enabled"), statt false zu
      // liefern (LFH-344, im Bundle gemessen) — deshalb der `enabled`-Riegel davor. Ohne
      // eigenen Punkt wird terra-draw gar nicht erst gefragt.
      if (!aktiv || !draw.enabled || gesetztePunkte.length === 0) return false;
      if (!draw.undo()) return false;
      gesetztePunkte.pop();
      melde();
      return true;
    },
    verwerfen: () => {
      if (!aktiv || !draw.enabled || aktiverModus == null) return;
      // Dieselbe Folge wie beim Re-Aktivieren in `starten`: Entwurf weg, Modus neu setzen.
      draw.clear();
      draw.setMode(MODUS_NAME[aktiverModus]);
      gesetztePunkte.length = 0;
      melde();
    },
  };
}
