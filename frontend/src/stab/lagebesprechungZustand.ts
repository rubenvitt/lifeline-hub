import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { StatusDarstellung } from '../theme/statusFarben';

dayjs.extend(utc);

/**
 * Wire-Zeit → Zeitpunkt. Der Wire-String ist UTC OHNE Zonenkennung ('YYYY-MM-DD HH:mm:ss');
 * `dayjs(s)` läse ihn als Ortszeit und verschöbe ihn still um den Zonenversatz. `null` bei
 * fehlendem oder unlesbarem Wert — ein `Invalid Date` ist von außen nicht von einem Termin
 * zu unterscheiden.
 */
export function terminZeitpunkt(wire: string | null | undefined): Dayjs | null {
  if (!wire) return null;
  const d = dayjs.utc(wire);
  return d.isValid() ? d.local() : null;
}

/** „23 min" · „2 h 05 min" — ganze Minuten. */
export function dauerText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  const stunden = Math.floor(minuten / 60);
  return `${stunden} h ${String(minuten % 60).padStart(2, '0')} min`;
}

/**
 * Stand der nächsten Lagebesprechung (LFH-543, Spec 10): „in 23 min" neutral, „seit 5 min
 * überfällig" `achtung`, „kein Termin" neutral. Das Wort ist der zweite Kanal (WCAG 1.4.1).
 *
 * Rein und mit `jetzt` als Argument: die Seite tickt alle 30 s, der Test braucht keine Uhr.
 * Gerechnet wird in absoluten Millisekunden, nie in Wanduhrzeit — an der Sommerzeitgrenze
 * lägen sonst eine Stunde daneben. `termin ≤ jetzt` gilt als überfällig; abgerundet.
 *
 * Eine FUNKTION, keine Karte: `statusVertrag.guard` verbietet `Record<…, StatusDarstellung>`
 * außerhalb `theme/statusFarben.ts`, und dort zählt der Abdeckungstest die Vertragskarten.
 */
export function lagebesprechungZustand(
  terminWire: string | null | undefined,
  jetzt: Dayjs,
): StatusDarstellung {
  if (!terminWire) return { rolle: 'neutral', label: 'kein Termin' };
  const termin = terminZeitpunkt(terminWire);
  if (!termin) return { rolle: 'neutral', label: 'Termin unlesbar' };
  const abstandMs = termin.valueOf() - jetzt.valueOf();
  const minuten = Math.floor(Math.abs(abstandMs) / 60_000);
  if (abstandMs > 0) return { rolle: 'neutral', label: `in ${dauerText(minuten)}` };
  return { rolle: 'achtung', label: `seit ${dauerText(minuten)} überfällig` };
}
