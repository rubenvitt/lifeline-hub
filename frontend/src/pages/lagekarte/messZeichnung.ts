import type { Map as MapLibreMap } from 'maplibre-gl';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { radiusMessung, type MessForm, type MessGeometrie } from './messung';
import { entferneKreisVorschau, MESS_KREIS_EBENEN, sorgeFuerKreisVorschau } from './kreisVorschau';

/** App-Form → terra-draw-Modusname. */
// Der Radius (LLH-1043) ist ein Linienzug Mitte → Rand; gerechnet wird in `messung.ts`.
const MODUS_NAME: Record<MessForm, string> = {
  strecke: 'linestring',
  flaeche: 'polygon',
  radius: 'linestring',
};
/** App-Form → GeoJSON-Typ der Figur, die terra-draw in diesem Modus zeichnet. */
const GEOMETRIE: Record<MessForm, string> = {
  strecke: 'LineString',
  flaeche: 'Polygon',
  radius: 'LineString',
};

export interface MessZeichnung {
  starten: (form: MessForm) => void;
  stoppen: () => void;
  zerstoeren: () => void;
  /** Schließt die laufende Messung ab (Enter-Geste); false, solange zu wenige Punkte stehen. */
  abschliessen: () => boolean;
  /** Setzt den ersten Punkt der laufenden Messung („Messen ab hier“, LFH-776); ohne Messung nichts. */
  setzeStartpunkt: (punkt: { lng: number; lat: number }) => void;
}

/**
 * Zeichnung fürs Messwerkzeug — ein eigener terra-draw-Controller neben den beiden aus
 * `zeichnen.ts`:
 * 1. Der Wert läuft mit: Messen meldet bei jeder Änderung (`change`), samt Vorschaupunkt unter dem
 *    Zeiger — die Strecke bis zum Zeiger ist die Frage beim Messen.
 * 2. Es steht höchstens eine Messung da: terra-draw bleibt nach dem Abschluss im Modus, und die
 *    abgeschlossene Figur wird beim nächsten Klick entfernt statt gestapelt. Gespeichert wird
 *    nichts.
 * 3. In der Form „Radius“ steht der Kreis mit (LLH-1345): eigene Ebenen `td-mess-kreis-*`
 *    (`MESS_KREIS_EBENEN`) unter der Zeichnung, aus derselben Mitte und demselben Rand wie die
 *    Anzeige (`radiusMessung`). Er lebt mit jeder Meldung und geht mit `starten`, `stoppen` und
 *    `zerstoeren` — also auch vor `setStyle` und vor `map.remove()`.
 *
 * terra-draw legt seine Layer nach `setStyle` nicht neu an; den Kartenwechsel fängt `Kartenflaeche`
 * ab (Messung räumen, Stil setzen, nach `style.load` neu beginnen).
 */
export function createMessung(
  map: MapLibreMap,
  onMessungAussen: (g: MessGeometrie | null, fertig: boolean) => void,
  /** Farbe des Vorschaukreises; gelesen bei jedem Nachzeichnen (Moduswechsel hell/dunkel). */
  kreisFarbe: () => string = () => '#000',
): MessZeichnung {
  const draw = new TerraDraw({
    // Eigener Präfix — Begründung am Parameter `praefix` von `createZeichnung`.
    adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: 'td-mess' }),
    modes: [new TerraDrawPolygonMode(), new TerraDrawLineStringMode()],
  });
  const canvas = map.getCanvas();
  let laufend: string | number | null = null;
  let fertig: string | number | null = null;
  let aktiv = false;
  let form: MessForm = 'strecke';
  /** Eigenes Entfernen löst selbst `change` aus — das darf keine Meldung erzeugen. */
  let raeumt = false;
  /** Steht der Vorschaukreis auf der Karte? Ohne ihn fasst der Abbau den Stil nicht an. */
  let kreisSteht = false;

  const kreisWeg = () => {
    if (!kreisSteht) return;
    kreisSteht = false;
    entferneKreisVorschau(map, MESS_KREIS_EBENEN);
  };

  /** Jede Meldung zeichnet den Vorschaukreis nach, dann geht sie hinaus. */
  const onMessung = (g: MessGeometrie | null, fertig: boolean) => {
    const kreis = form === 'radius' ? radiusMessung(g) : null;
    if (kreis) {
      sorgeFuerKreisVorschau(map, { ...kreis, farbe: kreisFarbe() }, MESS_KREIS_EBENEN);
      kreisSteht = true;
    } else {
      kreisWeg();
    }
    onMessungAussen(g, fertig);
  };

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
    // terra-draw meldet neben der Figur eigene Hilfspunkte (Typ `Point`) als `create`. Laufend ist
    // nur die Figur der gewählten Form — ein Hilfspunkt ließe den Wert auf „—" stehen.
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
      // Der Entwurf verschwindet ohne unser Zutun (terra-draw bricht ab). Über Escape kommt das
      // nicht vor — der Fenster-Handler der Seite beendet den Modus schon beim `keydown`,
      // terra-draw reagiert erst auf `keyup`.
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
      // Wirft terra-draw, weil die Karte schon entfernt ist, bleibt der Abbau trotzdem vollständig
      // (`lagekarte/AGENTS.md`, „Zeichnen und Messen“, LFH-943).
      try {
        if (draw.enabled) draw.stop();
      } catch {
        /* Karte schon entfernt */
      }
      try {
        kreisWeg();
      } catch {
        /* Karte schon entfernt */
      }
    },
    abschliessen: () => {
      if (!aktiv || laufend == null) return false;
      // Der laufende Entwurf enthält den Vorschaupunkt; auf dem Touchschirm liegt er auf dem
      // letzten Punkt und zählt nicht doppelt.
      if (punkteZahl(geometrie(laufend)) < (form === 'flaeche' ? 3 : 2)) return false;
      // Keine öffentliche finish()-API — dieselbe Geste wie in `zeichnen.ts`.
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      return fertig != null;
    },
    setzeStartpunkt: ({ lng, lat }) => {
      if (!aktiv) return;
      // Keine öffentliche API für einen Punkt in einer laufenden Zeichnung (`addFeatures` nimmt nur
      // fertige Figuren) — derselbe Weg wie ein Klick: primärer Zeiger am Kartenelement des
      // Adapters (Canvas), Lage über das Rechteck des Containers, aus dem terra-draw zurückrechnet.
      // LFH-776, `openspec/changes/archive/2026-10-03-lfh-776-lagekarte-kontextmenue/design.md` D6.
      const p = map.project([lng, lat]);
      const rahmen = map.getContainer().getBoundingClientRect();
      const init: PointerEventInit = {
        clientX: rahmen.left + p.x,
        clientY: rahmen.top + p.y,
        isPrimary: true,
        button: 0,
        pointerType: 'mouse',
        bubbles: true,
        cancelable: true,
      };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...init, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    },
  };
}
