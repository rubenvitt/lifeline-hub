/**
 * Wächter für die Basemap-Degradation (online → offline → blind).
 *
 * Drei Annahmen, die nicht tragen:
 * 1. `load` wartet auf die Kacheln: `Map.loaded()` verlangt, dass jede sichtbare Kachel `loaded`
 *    oder `errored` ist. Ein Kachel-404 feuert damit zwangsläufig vor `load`, das Fenster umfasst
 *    den ganzen ersten Kachel-Lauf.
 * 2. Die Karte wird mit dem echten Style konstruiert. Sie entsteht mit dem Blindstil, bevor die
 *    Kartenansicht hydriert ist; der Online-Style kommt erst per `setStyle`. Schloss das
 *    `style.load` des Platzhalters das Fenster für immer, blieb die Karte bei einem 404 ganz ohne
 *    Style und ohne Lagedaten stehen (gemessen, LFH-558, `e2e/lagekarte-kartengrundlage.spec.ts`).
 * 3. Eine kumulative Abstufung (ein Schritt je Fehler) springt bei zwei Fehlern von `online` direkt
 *    auf `blind`, während der Umschalter „Online" zeigt (die Abstufung ändert nur die Anzeige,
 *    nicht die Wahl).
 *
 * Deshalb:
 * - Kachel-Fehler stufen nie ab (`e.tile` gesetzt, `ErrorEvent(err, { tile })`).
 * - Jeder angewandte Style öffnet ein eigenes Fenster (`stilAngewandt()`), in dem höchstens EINE
 *   Abstufung fällt — auch nach einem Wechsel von Hand. Praktisch bleibt online → offline: greifbar
 *   ist nur der Ladefehler eines Online-Vektor-Views (Style-JSON per URL). Raster-Views und
 *   Ersatz-Styles sind inline, für sie feuert `style.load` sofort.
 * - Das Fenster schließt mit `stilGeladen()`. Das Signal ist `style.load`, nicht `load`: es
 *   feuert, sobald das Style-JSON angewandt ist, und bei einem gescheiterten Style-Fetch gar nicht.
 * - Im Fenster zählt jeder Fehler ohne `tile` — deshalb darf die Karte selbst dort keine werfen
 *   (ein `isSourceLoaded` auf eine noch fehlende Quelle meldet MapLibre als `error`-Event).
 */

/** Was der Wächter von einem MapLibre-`error`-Event braucht (strukturell, nicht nominal). */
interface StilFehlerEreignis {
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

interface StilFehlerWaechter {
  /** Ein (neuer) Style wurde auf die Karte gesetzt — ein neues Fenster bis zu seinem Laden. */
  stilAngewandt(): void;
  /** Die Karte hat den Style geladen (`style.load`) — bis zum nächsten Style stuft nichts ab. */
  stilGeladen(): void;
  /** `true` = dieser Fehler rechtfertigt genau eine Abstufung. */
  meldeFehler(e: StilFehlerEreignis | undefined | null): boolean;
}

export function neuerStilFehlerWaechter(): StilFehlerWaechter {
  let geladen = false;
  let abgestuft = false;
  return {
    stilAngewandt() {
      geladen = false;
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
