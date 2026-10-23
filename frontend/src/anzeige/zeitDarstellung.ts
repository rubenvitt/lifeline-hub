/**
 * Zeitdarstellung — der eine Formatkern für Zeitpunkte in der Anzeige (LLH-1053, Spec
 * `zeitdarstellung`; Regel: `frontend/AGENTS.md`, „Zeitdarstellung“).
 *
 * Drei Rollen, je in zwei Darstellungen:
 *
 * | Rolle       | taktisch (Vorgabe)        | Datum und Uhrzeit              |
 * | ----------- | ------------------------- | ------------------------------ |
 * | `zeitpunkt` | `101430okt26`             | `10.10.26 14:30`               |
 * | `zeitKurz`  | heute `1430`, sonst `091430` | heute `14:30`, sonst `09.10. 14:30` |
 * | `uhrzeit`   | `1430`                    | `14:30`                        |
 *
 * `uhrzeit` nur, wo der Tag fest aus dem Zusammenhang folgt (eine Tagesspalte, ein Plan für einen
 * Tag). Dazu {@link datum}, der Kalendertag eines Zeitpunkts ohne Uhrzeit (Tageskopf, `{datum}`
 * im ETB-Baustein): taktisch der Tagesteil der DTG `10okt26`, sonst `10.10.26` (LLH-1061). Die Darstellung kommt aus den Konventionen (`konventionen.zeitdarstellung`, wirksam nach
 * {@link wirksameZeitdarstellung}); die Provider in `AnzeigeKonventionenContext.tsx` setzen sie.
 *
 * Volle DTG (Entscheidung E1, LLH-1045, 22.10.2026): Tag, Uhrzeit, Monat, Jahr zweistellig, alles
 * klein und ohne Leerzeichen. Quelle der Systematik: FwDV/DV 810 „Sprech- und Datenfunkverkehr“,
 * Ausgabe 2018, Teil I, 5.1.1.12 („Tag des Monats – Uhrzeitgruppe (hhmm), soweit erforderlich
 * können Monat und Jahr angefügt werden“, Beispiel „Empfangsbestätigung – 271938jan19“). Die
 * Vorschrift nennt nur dieses eine Monatskürzel; die Liste der zwölf (ohne Umlaut, also `mrz`) ist
 * Rubens Entscheidung E1, nicht ihr Wortlaut.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Zeitdarstellung } from '../api/types';
import type { AnzeigeKonventionen } from './format';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Ein Zeitpunkt, wie er ankommt: UTC-Wirestring oder `dayjs`; leer = nichts anzeigen. */
export type Zeitwert = string | Dayjs | null | undefined;

/** Die Vorgabe, wenn weder Gerät noch Einsatz noch Organisation etwas wählen (E3). */
export const ZEITDARSTELLUNG_VORGABE: Zeitdarstellung = 'taktisch';

/** Monatskürzel der vollen DTG (E1). Der Zeit-Parser (`zeitParser.ts`) liest dieselbe Tabelle. */
export const MONATE_DTG = [
  'jan',
  'feb',
  'mrz',
  'apr',
  'mai',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dez',
] as const;

/**
 * UTC-Wirestring → dayjs in der gewünschten Zeitzone (sonst lokal).
 * `d.tz(zone)` wirft bei ungültiger IANA-Zone; das Feld ist Freitext, ein Tippfehler ließe sonst
 * jedes Zeit-Rendering crashen — deshalb Fallback auf lokale Zeit.
 */
export function inZone(utcStr: string, konv: AnzeigeKonventionen) {
  const d = dayjs.utc(utcStr);
  if (!konv.zeitzone) return d.local();
  try {
    return d.tz(konv.zeitzone);
  } catch {
    return d.local();
  }
}

/**
 * Wirksame Darstellung: Gerät vor Einsatz vor Organisation vor Vorgabe (E3). Im Druck zählt das
 * Gerät nie (E4): ein Ausdruck ist ein Dokument der Führungsstelle, nicht des Bildschirms.
 */
export function wirksameZeitdarstellung(stufen: {
  geraet?: Zeitdarstellung | null;
  einsatz?: Zeitdarstellung | null;
  org?: Zeitdarstellung | null;
  druck?: boolean;
}): Zeitdarstellung {
  const geraet = stufen.druck ? null : stufen.geraet;
  return geraet ?? stufen.einsatz ?? stufen.org ?? ZEITDARSTELLUNG_VORGABE;
}

function darstellung(konv: AnzeigeKonventionen): Zeitdarstellung {
  return konv.zeitdarstellung ?? ZEITDARSTELLUNG_VORGABE;
}

/** Wert → Wanduhr der Anzeigezone; `null` bei leerem oder unlesbarem Wert. */
function wanduhr(wert: Zeitwert, konv: AnzeigeKonventionen): Dayjs | null {
  if (!wert) return null;
  if (typeof wert !== 'string' && !wert.isValid()) return null;
  const wire = typeof wert === 'string' ? wert : wert.utc().format('YYYY-MM-DD HH:mm:ss');
  const d = inZone(wire, konv);
  return d.isValid() ? d : null;
}

function dtgVoll(d: Dayjs): string {
  return `${d.format('DDHHmm')}${MONATE_DTG[d.month()]}${d.format('YY')}`;
}

/** Der Tagesteil der DTG: `10okt26`. */
function tagDtg(d: Dayjs): string {
  return `${d.format('DD')}${MONATE_DTG[d.month()]}${d.format('YY')}`;
}

/** Tag und Uhrzeit ohne Heute-Prüfung — die Form von `zeitKurz` an einem anderen Tag. */
export function zeitMitTag(d: Dayjs, art: Zeitdarstellung): string {
  return art === 'taktisch' ? d.format('DDHHmm') : d.format('DD.MM. HH:mm');
}

function nurUhrzeit(d: Dayjs, art: Zeitdarstellung): string {
  return art === 'taktisch' ? d.format('HHmm') : d.format('HH:mm');
}

/** Rolle „Zeitpunkt“: `101430okt26` bzw. `10.10.26 14:30`. */
export function zeitpunkt(wert: Zeitwert, konv: AnzeigeKonventionen): string {
  const d = wanduhr(wert, konv);
  if (!d) return '';
  return darstellung(konv) === 'taktisch' ? dtgVoll(d) : d.format('DD.MM.YY HH:mm');
}

/**
 * Rolle „kurz“ für Listen, Zeitachsen und Kennzahlen: heute nur die Uhrzeit, sonst Tag und
 * Uhrzeit. „Heute“ gilt in DERSELBEN Zone wie die Formatierung, sonst kippt die Tagesgrenze.
 * `jetzt` nur für Tests und reine Modelle, die ihre Uhr hereinreichen.
 */
export function zeitKurz(
  wert: Zeitwert,
  konv: AnzeigeKonventionen,
  jetzt: Dayjs | number = Date.now(),
): string {
  const d = wanduhr(wert, konv);
  if (!d) return '';
  const heute = wanduhr(dayjs(jetzt), konv);
  const art = darstellung(konv);
  return heute && d.isSame(heute, 'day') ? nurUhrzeit(d, art) : zeitMitTag(d, art);
}

/**
 * Kalendertag eines Zeitpunkts in der Anzeigezone, ohne Uhrzeit (LLH-1061): taktisch der Tagesteil
 * der vollen DTG `10okt26`, bei „Datum und Uhrzeit“ `10.10.26` — dieselbe Schreibweise wie
 * {@link zeitpunkt}, nur ohne die Uhrzeitgruppe.
 */
export function datum(wert: Zeitwert, konv: AnzeigeKonventionen): string {
  const d = wanduhr(wert, konv);
  if (!d) return '';
  return darstellung(konv) === 'taktisch' ? tagDtg(d) : d.format('DD.MM.YY');
}

/**
 * Ein Kalendertag `YYYY-MM-DD` (gespeichert ohne Uhrzeit und Zone, etwa ein Verpflegungstag) in
 * der Schreibweise von {@link datum}. Ohne Zonenrechnung: der Tag IST schon der Tag.
 */
export function kalendertag(tag: string | null | undefined, konv: AnzeigeKonventionen): string {
  if (!tag) return '';
  const d = dayjs.utc(tag.slice(0, 10));
  if (!d.isValid()) return '';
  return darstellung(konv) === 'taktisch' ? tagDtg(d) : d.format('DD.MM.YY');
}

/**
 * Tag und Uhrzeit ohne Heute-Prüfung (`101430` bzw. `10.10. 14:30`): die Form der Rolle „kurz“ an
 * einem anderen Tag, für den Anfang eines Zeitraums, der den Tag nennen muss. Liest keine Uhr.
 */
export function tagUndUhrzeit(wert: Zeitwert, konv: AnzeigeKonventionen): string {
  const d = wanduhr(wert, konv);
  if (!d) return '';
  return zeitMitTag(d, darstellung(konv));
}

/** Rolle „Uhrzeit“, nur wo der Tag aus dem Zusammenhang feststeht: `1430` bzw. `14:30`. */
export function uhrzeit(wert: Zeitwert, konv: AnzeigeKonventionen): string {
  const d = wanduhr(wert, konv);
  if (!d) return '';
  return nurUhrzeit(d, darstellung(konv));
}

/**
 * Leerwert einer Instrumentenspalte in Ziffernbreite der Darstellung, damit eine Lücke die
 * Nachbarzeilen nicht verschiebt.
 */
export function leereUhrzeit(konv: AnzeigeKonventionen): string {
  return darstellung(konv) === 'taktisch' ? '————' : '——:——';
}
