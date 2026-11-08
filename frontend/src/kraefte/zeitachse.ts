import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatDauer } from '../abloesung/dauer';
import type {
  Einsatzperiode,
  SchichtplanGrenzwerte,
  ZeitachseArt,
  ZeitachseEreignis,
  ZeitachseMarke,
  ZeitachseQuelle,
} from '../api/types';

dayjs.extend(utc);

/**
 * Kräfte-Zeitachse (LFH-552): Einsatzdauer, Gesamteinsatzzeit und Ruhezeit aus den Perioden,
 * die der Server bildet — gerechnet gegen die Uhr des Clients, damit die Dauer ohne neuen Abruf
 * weiterläuft (design.md D4). Die Zahl steht neutral da; eingestuft wird nur über
 * {@link stufeEin} gegen die Grenzwerte des Schichtplans (LLH-730).
 *
 * **Keine erfundenen Daten:** ohne Ereignis gibt es keine Dauer (`null`), nie `0`.
 *
 * Zeitpunkte sind UTC-Wirestrings ohne Zonenkennung und werden ausdrücklich als UTC gelesen
 * (`dayjs(s)` läse Ortszeit, vgl. `einsatz/einsatzDauer.ts`).
 */

/** Die laufende Periode: Dauer ab dem Anker (Alarmierung, sonst Eintreffen). */
export interface LaufendeDauer {
  minuten: number;
  anker: ZeitachseArt;
  beginnAt: string;
}

export interface KraftDauern {
  laufend: LaufendeDauer | null;
  /** Summe aller Perioden, die offene bis jetzt. */
  gesamtMinuten: number | null;
  /** Seit dem Ende der letzten Periode, solange keine offen ist. */
  ruheMinuten: number | null;
}

const KEINE: KraftDauern = { laufend: null, gesamtMinuten: null, ruheMinuten: null };

function ms(wire: string | null | undefined): number | null {
  if (!wire) return null;
  const t = dayjs.utc(wire);
  return t.isValid() ? t.valueOf() : null;
}

function minutenZwischen(vonMs: number, bisMs: number): number {
  return Math.max(0, Math.floor((bisMs - vonMs) / 60_000));
}

/** Leitet die Dauern einer Kraft aus ihren Perioden ab (Spec „Einsatzdauer und Ruhezeit"). */
export function kraftDauern(
  perioden: readonly Einsatzperiode[] | undefined,
  jetztMs: number,
): KraftDauern {
  if (!perioden || perioden.length === 0) return KEINE;
  let gesamt = 0;
  let laufend: LaufendeDauer | null = null;
  for (const p of perioden) {
    const von = ms(p.beginn_at);
    if (von == null) continue;
    const bis = ms(p.ende_at) ?? jetztMs;
    gesamt += minutenZwischen(von, bis);
    if (!p.ende_at) {
      laufend = { minuten: minutenZwischen(von, jetztMs), anker: p.anker, beginnAt: p.beginn_at };
    }
  }
  const letzte = perioden[perioden.length - 1];
  const ende = laufend ? null : ms(letzte.ende_at);
  return {
    laufend,
    gesamtMinuten: gesamt,
    ruheMinuten: ende == null ? null : minutenZwischen(ende, jetztMs),
  };
}

/**
 * Die Entlassung, die die letzte Periode schließt (LLH-1263): an einer entlassenen Person lehnt
 * der Server ihre Streichung ab (422), weil sonst eine offene Periode entstünde. Der Client sperrt
 * deshalb diesen einen Knopf mit Kurzgrund (LFH-966). `null`, wenn die letzte Periode offen ist
 * oder mit einer Ablösung endet.
 */
export function abschliessendeEntlassungId(
  perioden: readonly Einsatzperiode[] | undefined,
  ereignisse: readonly ZeitachseEreignis[] | undefined,
): number | null {
  const letzte = perioden?.[perioden.length - 1];
  if (!letzte?.ende_at || letzte.ende_art !== 'entlassung') return null;
  // Die letzte passende: bei gleicher Sekunde gilt die Reihenfolge der Erfassung (Server
  // `perioden::gehe`), die abschließende Entlassung ist also die spätere.
  const treffer = [...(ereignisse ?? [])]
    .reverse()
    .find(
      (e) => e.art === 'entlassung' && e.gestrichen_at == null && e.zeitpunkt_at === letzte.ende_at,
    );
  return treffer?.id ?? null;
}

/**
 * Dauer als Text: unter einer Stunde „40 min", sonst „7 h 40" (Minuten zweistellig). Keine
 * Tage: im Lagevortrag zählen Stunden („31 h 05"), und die Zahl springt nie zurück.
 */
export function dauerText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  const h = Math.floor(minuten / 60);
  const m = String(minuten % 60).padStart(2, '0');
  return `${h} h ${m}`;
}

/**
 * Einstufung der laufenden Periode gegen die wirksamen Grenzwerte des Einsatzes (LLH-730, Spec
 * `kraefte-zeitachse`, „Einstufung gegen die Grenzwerte des Einsatzes“). Dieselben Werte und
 * dieselbe Trennregel wie der Plan-Befund `dienst` (`src/abloesung/schichtplan/pruefung.rs`,
 * `dienststrecken`): eine Lücke trennt zwei Strecken nur, wenn sie größer als null und mindestens
 * die Mindestruhe ist. Wer eine Seite ändert, ändert die andere mit.
 *
 * - `zu_lang`: die laufende Strecke (vom Beginn ihrer ersten Periode bis jetzt) ist echt länger
 *   als der Höchstdienst.
 * - `ruhe_zu_kurz`: die Lücke vor der offenen Periode liegt über null und unter der Mindestruhe;
 *   nur, wenn nicht schon `zu_lang`.
 *
 * Ohne offene Periode, ohne Perioden oder ohne Grenzwerte `null`: keine erfundene Einstufung.
 */
export interface Einstufung {
  wort: 'zu_lang' | 'ruhe_zu_kurz';
  /** Beginn der laufenden Dienststrecke (Wirestring). */
  streckeBeginnAt: string;
  streckeMinuten: number;
  /** Ruhe vor der offenen Periode; `null`, wenn keine Periode davor liegt. */
  ruheMinuten: number | null;
}

export function stufeEin(
  perioden: readonly Einsatzperiode[] | undefined,
  grenzwerte: SchichtplanGrenzwerte | undefined,
  jetztMs: number,
): Einstufung | null {
  if (!perioden || perioden.length === 0 || !grenzwerte) return null;
  const folge = perioden
    .map((p) => ({ p, von: ms(p.beginn_at), bis: ms(p.ende_at) }))
    .filter((x): x is { p: Einsatzperiode; von: number; bis: number | null } => x.von != null)
    .sort((a, b) => a.von - b.von);
  const offen = folge[folge.length - 1];
  if (!offen || offen.p.ende_at) return null;

  const ruheMs = grenzwerte.min_ruhe_minuten * 60_000;
  let beginn = folge[0];
  let ende = folge[0].bis ?? jetztMs;
  for (const x of folge.slice(1)) {
    const luecke = x.von - ende;
    if (luecke > 0 && luecke >= ruheMs) beginn = x;
    ende = Math.max(ende, x.bis ?? jetztMs);
  }
  const streckeMinuten = minutenZwischen(beginn.von, jetztMs);

  const vorher = folge.length > 1 ? folge[folge.length - 2] : null;
  const vorherEnde = vorher ? (vorher.bis ?? null) : null;
  const ruheMinuten = vorherEnde == null ? null : minutenZwischen(vorherEnde, offen.von);
  const ruheLueckeMs = vorherEnde == null ? null : offen.von - vorherEnde;

  let wort: Einstufung['wort'] | null = null;
  if (streckeMinuten > grenzwerte.max_dienst_minuten) wort = 'zu_lang';
  else if (ruheLueckeMs != null && ruheLueckeMs > 0 && ruheLueckeMs < ruheMs) wort = 'ruhe_zu_kurz';
  if (!wort) return null;
  return { wort, streckeBeginnAt: beginn.p.beginn_at, streckeMinuten, ruheMinuten };
}

/** Das Wort der Einstufung, zweiter Kanal neben der Farbe. */
export const EINSTUFUNG_WORT: Record<Einstufung['wort'], string> = {
  zu_lang: 'zu lang',
  ruhe_zu_kurz: 'Ruhe zu kurz',
};

/**
 * Beschreibung der Einstufung (Tooltip und Screenreader): Strecke mit Höchstwert, dazu die kurze
 * Ruhe mit Mindestruhe; die Angabe, die das Wort begründet, steht vorn.
 */
export function einstufungText(
  e: Einstufung,
  grenzwerte: SchichtplanGrenzwerte,
  zeit: (utc: string) => string,
): string {
  const dienst = `Im Dienst seit ${zeit(e.streckeBeginnAt)}: ${dauerText(e.streckeMinuten)}, Höchstwert ${formatDauer(grenzwerte.max_dienst_minuten)}`;
  // Eine Lücke von 0 ist durchgehender Dienst, keine Ruhe: dann kein Ruhe-Teil.
  const kurz =
    e.ruheMinuten != null &&
    (e.wort === 'ruhe_zu_kurz' ||
      (e.ruheMinuten > 0 && e.ruheMinuten < grenzwerte.min_ruhe_minuten))
      ? `Ruhe davor ${dauerText(e.ruheMinuten)}, Mindestruhe ${formatDauer(grenzwerte.min_ruhe_minuten)}`
      : null;
  const teile = e.wort === 'ruhe_zu_kurz' ? [kurz, dienst] : [dienst, kurz];
  return teile.filter((t): t is string => t != null).join(' · ');
}

/** Wort je Ereignisart. */
export const ART_WORT: Record<ZeitachseArt, string> = {
  alarmierung: 'Alarmierung',
  eintreffen: 'Eintreffen',
  abloesung: 'Ablösung',
  entlassung: 'Entlassung',
};

/** Anker der laufenden Dauer als zugängliche Beschreibung: „seit Alarmierung 06:10". */
export function ankerText(anker: ZeitachseArt, uhrzeit: string): string {
  return `seit ${ART_WORT[anker]} ${uhrzeit}`;
}

/**
 * Herkunft eines Ereignisses als Wort (Spec „Anzeige": zweiter Kanal, nie nur Farbe). Beim
 * Fan-out nennt der Aufrufer zusätzlich den Namen der Einheit.
 */
export const HERKUNFT_WORT: Record<ZeitachseQuelle, string> = {
  status: 'aus Status',
  einheit: 'über Einheit',
  abloesung: 'aus Ablösung',
  nachtrag: 'nachgetragen',
  disposition: 'aus dem Einsatz entlassen',
  bereitstellungsraum: 'am Bereitstellungsraum',
};

/** Arten, die sich von Hand nachtragen lassen — die Ablösung entsteht nur aus dem Vollzug. */
export const NACHTRAG_ARTEN: readonly ZeitachseArt[] = ['alarmierung', 'eintreffen', 'entlassung'];

/** Auswahl der Zeitachsen-Marke im Status-Katalog. */
export const MARKE_WORT: Record<ZeitachseMarke, string> = {
  alarmierung: 'Alarmierung',
  eintreffen: 'Eintreffen',
  entlassung: 'Entlassung',
};
