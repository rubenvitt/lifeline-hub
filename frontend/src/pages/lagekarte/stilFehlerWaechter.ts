/**
 * Wächter für die Basemap-Degradation (online → offline → blind).
 *
 * Zwei Annahmen, die nicht tragen:
 * 1. `load` wartet auf die Kacheln: `Map.loaded()` verlangt, dass jede sichtbare Kachel `loaded`
 *    oder `errored` ist. Ein Kachel-404 feuert damit zwangsläufig vor `load` — und da die Karte
 *    erst nach dem Lade-Guard der Seite mit dem echten Kachel-Style konstruiert wird, umfasst das
 *    Fenster den ganzen ersten Kachel-Lauf.
 * 2. Eine kumulative Abstufung (ein Schritt je Fehler) springt bei zwei Fehlern von `online` direkt
 *    auf `blind`, während der Umschalter „Online" zeigt (die Abstufung ändert nur die Anzeige,
 *    nicht die Wahl).
 *
 * Deshalb:
 * - Kachel-Fehler stufen nie ab (`e.tile` gesetzt, `ErrorEvent(err, { tile })`).
 * - Höchstens eine Abstufung je angewandtem Style (`stilAngewandt()` schärft neu). Praktisch bleibt
 *   online → offline: greifbar ist nur der Ladefehler eines Online-Vektor-Views (Style-JSON per
 *   URL). Raster-Views und Ersatz-Styles sind inline, für sie feuert `style.load` sofort.
 * - Nach `stilGeladen()` keine Abstufung mehr. Das Signal ist `style.load`, nicht `load`: es
 *   feuert, sobald das Style-JSON angewandt ist, und bei einem gescheiterten Style-Fetch gar nicht.
 */

/** Was der Wächter von einem MapLibre-`error`-Event braucht (strukturell, nicht nominal). */
export interface StilFehlerEreignis {
  /** Bei Kachel-Ladefehlern gesetzt (`ErrorEvent(err, { tile })`), sonst undefined. */
  tile?: unknown;
}

/**
 * Ein Kachel-Fehler ist kein Style-Ladefehler. Alles andere (Style-JSON, Source/TileJSON nicht
 * ladbar) zählt als Ladefehler der Basemap.
 */
export function istStilLadefehler(e: StilFehlerEreignis | undefined | null): boolean {
  return e?.tile === undefined;
}

export interface StilFehlerWaechter {
  /** Ein (neuer) Style wurde auf die Karte gesetzt — eine Abstufung ist wieder möglich. */
  stilAngewandt(): void;
  /** Die Karte hat den Style geladen (`style.load`) — ab hier stuft nichts mehr ab. */
  stilGeladen(): void;
  /** `true` = dieser Fehler rechtfertigt genau eine Abstufung. */
  meldeFehler(e: StilFehlerEreignis | undefined | null): boolean;
}

export function neuerStilFehlerWaechter(): StilFehlerWaechter {
  let geladen = false;
  let abgestuft = false;
  return {
    stilAngewandt() {
      abgestuft = false;
    },
    stilGeladen() {
      geladen = true;
    },
    meldeFehler(e) {
      if (geladen || abgestuft || !istStilLadefehler(e)) return false;
      abgestuft = true;
      return true;
    },
  };
}
