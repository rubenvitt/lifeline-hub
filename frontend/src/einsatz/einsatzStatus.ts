import type { EinsatzStatus } from '../api/types';
import type { StatusDarstellung } from '../theme/statusFarben';

/**
 * Status eines Einsatzes als Statusrolle (LFH-328 · A2, hierher gezogen mit
 * LFH-345 · C10 / Befund M14).
 *
 * Lag bis hierher als modul-lokale Konstante in `EinsaetzePage`. Der zweite Leser ist
 * `EinsatzdatenPage`, und der hatte sie NICHT — dort stand `{einsatz.status}` roh im
 * Titel-Tag, also der Wire-Wert klein geschrieben. Das ist genau die Sorte Abweichung,
 * die niemandem auffällt: beide Seiten sahen für sich plausibel aus, und „aktiv" ist
 * zufällig auch ein deutsches Wort. Zwei Kopien wären dieselbe Falle noch einmal —
 * deshalb hier, neben `einsatzart.ts`, das denselben Weg schon gegangen ist.
 *
 * Trägt bewusst den Vertragstyp {@link StatusDarstellung} aus `theme/statusFarben.ts`:
 * damit ist `label` Pflichtfeld (zweiter Kanal, WCAG 1.4.1), die Farbe kommt über
 * `StatusTag` aus der Rollenachse statt als erfundener Wert, und der `Record` bricht
 * bei einer neuen `EinsatzStatus`-Variante aus dem Codegen.
 *
 * ── WARUM NICHT IN `theme/statusFarben.ts`, obwohl das der genannte Zielzustand ist ──
 *
 * Die Vertragstabelle der A0-Spec (§1.3) listet die Enums, die der Vertrag deckt;
 * `EinsatzStatus` ist keins davon. `statusFarben.test.ts` hält das maschinell fest:
 * die Abdeckungszusicherung zählt die Maps gegen eine Literal-Liste UND gegen
 * `toHaveLength(10)`. Ein elfter Eintrag ist damit eine Änderung am Vertrag und an
 * seinem Guard — eine eigene Entscheidung, kein Nebenprodukt eines Seitenumbaus.
 * Der Zielzustand bleibt ein `einsatzStatus`-Export dort; dieser Umzug ist die
 * seitliche Hälfte davon (weg aus der Seite), nicht die senkrechte.
 *
 * Die Zuordnung selbst ist nicht hier entschieden, sondern zitiert (A0-Spec §6,
 * Prüflistenzeile 7: `aktiv` → `normal`, `abgeschlossen` → `neutral`).
 */
export const EINSATZ_STATUS: Record<EinsatzStatus, StatusDarstellung> = {
  // Grossgeschrieben, weil es eine BESCHRIFTUNG ist und kein Enum-Wert. Der Bestand
  // gab hier den Schlüssel selbst zurück — dann ist der zweite Kanal formal erfüllt und
  // sagt trotzdem nur, wie das Feld in der Datenbank heisst.
  aktiv: { rolle: 'normal', label: 'Aktiv' },
  abgeschlossen: { rolle: 'neutral', label: 'Abgeschlossen' },
};
