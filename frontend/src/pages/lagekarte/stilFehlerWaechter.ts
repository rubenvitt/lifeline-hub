/**
 * Wächter für die Basemap-Degradation (online → offline → blind).
 *
 * Hintergrund/Fehlerbild (LFH-325): die Abstufung hing an „irgendein MapLibre-`error` kam,
 * bevor `map.on('load')` feuerte". Beide Hälften dieser Annahme sind falsch:
 *
 * 1. **`load` wartet auf die Kacheln.** `Map.loaded()` verlangt `Style.loaded()`, das wiederum
 *    jeden TileManager als geladen sehen will — und der ist erst fertig, wenn JEDE sichtbare
 *    Kachel `loaded` ODER `errored` ist (maplibre-gl: `Map.loaded`, `Style.loaded`,
 *    `TileManager.loaded`). Ein Kachel-404 feuert damit zwangsläufig VOR `load`. Solange die
 *    Karte mit dem Blind-Style (`sources: {}`) startete, war das Fenster ein Frame lang und
 *    fiel nicht auf; seit die Kartenfläche erst nach dem Lade-Guard der Seite mountet
 *    (`LagekartePage`: `if (ladt) return <Spin/>`), wird die Karte direkt mit dem echten
 *    Kachel-Style konstruiert — und das Fenster umfasst den kompletten ersten Kachel-Lauf.
 * 2. **Die Abstufung war kumulativ.** Jeder Fehler stufte eine Stufe ab, ohne dass ein
 *    Style-Wechsel dazwischen liegen musste: zwei Fehler im selben Fenster sprangen von
 *    `online` direkt auf `blind` — sichtbar als „Umschalter steht auf Online, Karte ist blind",
 *    weil die Abstufung bewusst nur die ANZEIGE (`basemapFallback`) ändert, nicht die Wahl.
 *
 * Der Wächter trennt deshalb sauber:
 * - **Kachel-Fehler stufen NIE ab** (`e.tile` gesetzt — maplibre feuert sie als
 *   `ErrorEvent(err, { tile })`). Eine einzelne fehlende Kachel darf niemanden aus dem
 *   Online-Modus werfen; das war schon die dokumentierte Absicht, nur nicht die Wirkung.
 * - **Höchstens eine Abstufung je angewandtem Style.** `stilAngewandt()` (beim `setStyle`)
 *   schärft den Wächter wieder — ein Fehlerbündel im selben Ladefenster springt damit nie
 *   zwei Stufen. Praktisch bleibt davon **online → offline** übrig: greifbar ist nur der
 *   Ladefehler eines Online-VEKTOR-Views (Style-JSON per URL). Raster-Views und die
 *   Ersatz-Styles (offline/blind) sind INLINE `StyleSpecification`s — für sie feuert
 *   `style.load` sofort, das Fenster ist zu, sie stufen nie ab. Das ist gewollt: ein
 *   inline erzeugter Style kann gar nicht „nicht laden", nur seine Kacheln können fehlen.
 * - **Nach `stilGeladen()` gar keine Abstufung mehr** (unverändert: nur der initiale
 *   Ladefehler stuft ab). Das Signal dafür ist `map.on('style.load')`, NICHT `'load'`:
 *   `style.load` feuert in `Style._load`, also sobald das Style-JSON geladen und angewandt
 *   ist — und bei einem gescheiterten Style-Fetch gar nicht (dort feuert ein ErrorEvent).
 */

/** Was der Wächter von einem MapLibre-`error`-Event braucht (strukturell, nicht nominal). */
export interface StilFehlerEreignis {
  /** Bei Kachel-Ladefehlern gesetzt (`ErrorEvent(err, { tile })`), sonst undefined. */
  tile?: unknown;
}

/**
 * Ein Kachel-Fehler ist KEIN Style-Ladefehler. Alles andere (Style-JSON nicht ladbar,
 * Source/TileJSON nicht ladbar) zählt als Ladefehler der Basemap.
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
