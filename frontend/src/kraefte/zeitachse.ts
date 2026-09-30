import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Einsatzperiode, ZeitachseArt, ZeitachseMarke, ZeitachseQuelle } from '../api/types';

dayjs.extend(utc);

/**
 * Kräfte-Zeitachse (LFH-552): Einsatzdauer, Gesamteinsatzzeit und Ruhezeit aus den Perioden,
 * die der Server bildet — gerechnet gegen die Uhr des Clients, damit die Dauer ohne neuen Abruf
 * weiterläuft (design.md D4). Keine Grenzwerte, keine Einstufung: die Zahl steht neutral da.
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
 * Dauer als Text: unter einer Stunde „40 min", sonst „7 h 40" (Minuten zweistellig). Keine
 * Tage: im Lagevortrag zählen Stunden („31 h 05"), und die Zahl springt nie zurück.
 */
export function dauerText(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  const h = Math.floor(minuten / 60);
  const m = String(minuten % 60).padStart(2, '0');
  return `${h} h ${m}`;
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
};

/** Arten, die sich von Hand nachtragen lassen — die Ablösung entsteht nur aus dem Vollzug. */
export const NACHTRAG_ARTEN: readonly ZeitachseArt[] = ['alarmierung', 'eintreffen', 'entlassung'];

/** Auswahl der Zeitachsen-Marke im Status-Katalog. */
export const MARKE_WORT: Record<ZeitachseMarke, string> = {
  alarmierung: 'Alarmierung',
  eintreffen: 'Eintreffen',
  entlassung: 'Entlassung',
};
