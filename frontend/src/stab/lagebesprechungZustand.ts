import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { alsZeitpunkt } from '../anzeige/zeitEingabe';
import type { StatusDarstellung } from '../theme/statusFarben';

dayjs.extend(utc);

/**
 * Wire-Zeit → Zeitpunkt. Der Wire-String ist UTC OHNE Zonenkennung, `dayjs(s)` läse ihn als
 * Ortszeit. `null` bei fehlendem oder unlesbarem Wert — ein `Invalid Date` sähe aus wie ein Termin.
 * Ein ZEITPUNKT, keine Wanduhr: Felder wandeln selbst in die Anzeigezone (LFH-692).
 */
export function terminZeitpunkt(wire: string | null | undefined): Dayjs | null {
  return alsZeitpunkt(wire) ?? null;
}

/** „23 min" · „2 h 05 min" — ganze Minuten. */
export function dauerText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  const stunden = Math.floor(minuten / 60);
  return `${stunden} h ${String(minuten % 60).padStart(2, '0')} min`;
}

/**
 * Stand der nächsten Lagebesprechung: „in 23 min" neutral, „seit 5 min überfällig" `achtung`
 * (über {@link lagebesprechungUeberfaellig}), „kein Termin" neutral; das Wort ist der zweite
 * Kanal (WCAG 1.4.1).
 *
 * Rein, mit `jetzt` als Argument. Gerechnet in absoluten Millisekunden, nie in Wanduhrzeit
 * (Sommerzeitgrenze). `termin ≤ jetzt` gilt als überfällig; abgerundet. Unter einer Minute
 * „in < 1 min" bzw. ab dem Termin „jetzt fällig".
 *
 * Eine FUNKTION, keine Karte: `statusVertrag.guard` verbietet `Record<…, StatusDarstellung>`
 * außerhalb `theme/statusFarben.ts`.
 */
export function lagebesprechungZustand(
  terminWire: string | null | undefined,
  jetzt: Dayjs,
): StatusDarstellung {
  if (!terminWire) return { rolle: 'neutral', label: 'kein Termin' };
  const termin = terminZeitpunkt(terminWire);
  if (!termin) return { rolle: 'neutral', label: 'Termin unlesbar' };
  const ueberfaellig = lagebesprechungUeberfaellig(termin, jetzt);
  if (ueberfaellig) return ueberfaellig;
  const minuten = Math.floor((termin.valueOf() - jetzt.valueOf()) / 60_000);
  return { rolle: 'neutral', label: minuten === 0 ? 'in < 1 min' : `in ${dauerText(minuten)}` };
}

/**
 * Ton und Wort eines erreichten oder verstrichenen Besprechungstermins — die EINE Heimat dieser
 * Regel (LFH-859, `stab/AGENTS.md`): die Stab-Seite (`lagebesprechungZustand`) und die
 * Fristenliste des Führungsüberblicks (`markenBewertung`, Marke „Lagebesprechung") lesen beide
 * hier. `achtung`, nie `alarm`: eine Besprechung ist kein Gefahrenereignis (Alarmbudget
 * EEMUA 191). In der ersten Minute „jetzt fällig", danach „seit 5 min überfällig".
 *
 * `null`, solange der Termin in der Zukunft liegt; den kommenden Termin bewertet jeder Aufrufer
 * selbst. Der Rückgabetyp hält `achtung` als Literal fest, damit er in `MarkenTon` passt.
 */
export function lagebesprechungUeberfaellig(
  termin: Dayjs,
  jetzt: Dayjs,
): { rolle: 'achtung'; label: string } | null {
  const seitMs = jetzt.valueOf() - termin.valueOf();
  if (seitMs < 0) return null;
  const minuten = Math.floor(seitMs / 60_000);
  if (minuten === 0) return { rolle: 'achtung', label: 'jetzt fällig' };
  return { rolle: 'achtung', label: `seit ${dauerText(minuten)} überfällig` };
}
