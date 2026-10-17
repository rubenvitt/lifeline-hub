/**
 * Die EINE Deutung getippter Zeitpunkte (Spec `zeiteingabe`, „Eingabe als Text“ ff.; Herleitung
 * `openspec/changes/archive/2026-10-17-ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`, D2). Rein, ohne React und
 * ohne Uhr: `jetzt` reicht der Aufrufer herein (im Baustein `serverJetzt()`).
 *
 * Gelesen wird als Wanduhr der Anzeigezone; der Zeitpunkt entsteht über
 * {@link uhrzeitAmTag} (doppelte Stunde: die erste, Lücke: nach vorn), damit es genau eine
 * Sommerzeitregel gibt. Ziffernblöcke sind nach ihrer Länge eindeutig: 3–4 Ziffern Uhrzeit,
 * 6 Ziffern Tag und Uhrzeit; alles andere wird nicht erraten, sondern abgelehnt.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { MONATE_DTG } from './format';
import { naechsterTag, uhrzeitAmTag } from './uhrzeit';
import { heuteInZone, tagInZone } from './zeitEingabe';

dayjs.extend(utc);

/** Ereignis: liegt in der Vergangenheit. Frist: liegt in der Zukunft. */
export type ZeitArt = 'ereignis' | 'frist';

export interface DeutungsOptionen {
  /** Anzeigezone; ungültig oder leer = Browserzone. */
  zone: string | null | undefined;
  /** Der aktuelle Zeitpunkt (Serveruhr). */
  jetzt: Dayjs;
  art?: ZeitArt;
  /** Tage nach heute sind nicht erlaubt; ohne `art` gilt das Feld dann als Ereignisfeld. */
  keineZukunftstage?: boolean;
  /**
   * Eine bloße Uhrzeit liegt am Tag dieses Zeitpunkts und muss nach ihm liegen, sonst am
   * Folgetag (Ende eines Zeitraums, Bezug = Beginn).
   */
  bezug?: Dayjs | null;
  /** Nur ein Kalendertag, keine Uhrzeit (Ergebnis: 00:00 des Tages in der Anzeigezone). */
  nurTag?: boolean;
}

export type Deutung =
  | { ok: true; zeitpunkt: Dayjs | null; hinweis?: 'gestern' | 'morgen' }
  | { ok: false; grund: string };

/** Gründe stehen am Feld: wenige Wörter, kein Satz (`frontend/AGENTS.md`, LFH-1078). */
export const GRUND = {
  unlesbar: 'nicht lesbar',
  uhrzeit: 'Uhrzeit gibt es nicht',
  tag: 'Tag gibt es nicht',
  monat: 'Monat gibt es nicht',
  monatsname: 'Monat unbekannt',
  zukunft: 'liegt in der Zukunft',
} as const;

/**
 * Uhren gehen nie gleich: eine Ereigniszeit bis zu fünf Minuten voraus gilt noch heute, sonst
 * landete „1430“ um 14:29:30 auf gestern. Für Fristen spiegelbildlich.
 */
const TOLERANZ_MIN = 5;

/** Monatskürzel → Monatsnummer 1–12; mit und ohne Umlaut, dazu die englischen Abweichungen. */
const MONATSNAMEN: Record<string, number> = {
  ...Object.fromEntries(MONATE_DTG.map((m, i) => [m, i + 1])),
  mär: 3,
  maer: 3,
  mar: 3,
  may: 5,
  oct: 10,
  dec: 12,
};

const UHRZEIT = /^([0-9]{1,2})[:.]?([0-9]{2})$/;
const TAG_UHRZEIT = /^([0-9]{2})([0-9]{2})([0-9]{2})$/;
const DTG = /^([0-9]{2})([0-9]{2})([0-9]{2}) ?([a-zäöü]{3,4}) ?([0-9]{2}|[0-9]{4})?$/;
const DEUTSCH = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2}|[0-9]{4})?,? ([0-9]{1,2})[:.]?([0-9]{2})$/;
const ISO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})[ t]([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$/;
const RELATIV = /^([+-]) ?([0-9]{1,4}) ?(m|min|h|std)?$/;
const DEUTSCH_TAG = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2}|[0-9]{4})?$/;
const ISO_TAG = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

interface Uhr {
  stunde: number;
  minute: number;
  sekunde: number;
}

interface Datum {
  jahr: number;
  monat: number;
  tag: number;
}

const zwei = (n: number) => String(n).padStart(2, '0');
const tagText = (d: Datum) => `${d.jahr}-${zwei(d.monat)}-${zwei(d.tag)}`;

function datumAus(tag: string): Datum {
  const [jahr, monat, t] = tag.split('-').map(Number);
  return { jahr, monat, tag: t };
}

function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

function gibtEsTag(d: Datum): boolean {
  return d.monat >= 1 && d.monat <= 12 && d.tag >= 1 && d.tag <= tageImMonat(d.jahr, d.monat);
}

function gibtEsUhr(u: Uhr): boolean {
  return u.stunde <= 23 && u.minute <= 59 && u.sekunde <= 59;
}

function vollesJahr(jahr: string | undefined, vorgabe: number): number {
  if (!jahr) return vorgabe;
  return jahr.length === 2 ? 2000 + Number(jahr) : Number(jahr);
}

function zeitpunktAm(d: Datum, u: Uhr, zone: DeutungsOptionen['zone']): Dayjs {
  return uhrzeitAmTag(tagText(d), `${zwei(u.stunde)}:${zwei(u.minute)}`, zone).add(
    u.sekunde,
    'second',
  );
}

function tagVersetzt(tag: string, tage: number): string {
  return tage === 1 ? naechsterTag(tag) : dayjs.utc(tag).add(tage, 'day').format('YYYY-MM-DD');
}

function monatVersetzt(d: Datum, monate: number): Datum {
  const m = d.monat - 1 + monate;
  return { jahr: d.jahr + Math.floor(m / 12), monat: (((m % 12) + 12) % 12) + 1, tag: d.tag };
}

/** Wohin eine unvollständige Angabe fällt, wenn sie in der falschen Richtung liegt. */
function richtung(o: DeutungsOptionen): -1 | 0 | 1 {
  const art = o.art ?? (o.keineZukunftstage ? 'ereignis' : undefined);
  return art === 'ereignis' ? -1 : art === 'frist' ? 1 : 0;
}

/** Liegt der Kandidat in der falschen Richtung (mit Toleranz)? */
function falschHerum(kandidat: Dayjs, o: DeutungsOptionen): boolean {
  const r = richtung(o);
  if (r === -1) return kandidat.isAfter(o.jetzt.add(TOLERANZ_MIN, 'minute'));
  if (r === 1) return kandidat.isBefore(o.jetzt.subtract(TOLERANZ_MIN, 'minute'));
  return false;
}

type Ergebnis = { zeitpunkt: Dayjs } | { grund: string };

/** Nur die Uhrzeit: heute bzw. am Tag des Bezugs, nach Feldart verschoben. */
function ausUhrzeit(u: Uhr, o: DeutungsOptionen): Ergebnis {
  if (!gibtEsUhr(u)) return { grund: GRUND.uhrzeit };
  if (o.bezug) {
    const tag = tagInZone(o.bezug, o.zone);
    const am = zeitpunktAm(datumAus(tag), u, o.zone);
    return {
      zeitpunkt: am.isAfter(o.bezug) ? am : zeitpunktAm(datumAus(naechsterTag(tag)), u, o.zone),
    };
  }
  const heute = heuteInZone(o.zone, o.jetzt);
  const kandidat = zeitpunktAm(datumAus(heute), u, o.zone);
  if (!falschHerum(kandidat, o)) return { zeitpunkt: kandidat };
  return { zeitpunkt: zeitpunktAm(datumAus(tagVersetzt(heute, richtung(o))), u, o.zone) };
}

/**
 * Ein Tag mit Monat oder Jahr, die fehlen dürfen: es gilt der laufende Monat bzw. das laufende
 * Jahr, nach Feldart ein Schritt zurück oder vor, wenn der Kandidat falsch herum läge oder den Tag
 * dort nicht gibt.
 */
function ausTeilDatum(
  teil: { tag: number; monat?: number; jahr?: number },
  u: Uhr,
  o: DeutungsOptionen,
): Ergebnis {
  if (!gibtEsUhr(u)) return { grund: GRUND.uhrzeit };
  if (teil.monat !== undefined && (teil.monat < 1 || teil.monat > 12))
    return { grund: GRUND.monat };
  const heute = datumAus(heuteInZone(o.zone, o.jetzt));
  const kandidat: Datum = {
    jahr: teil.jahr ?? heute.jahr,
    monat: teil.monat ?? heute.monat,
    tag: teil.tag,
  };
  const vollstaendig = teil.jahr !== undefined && teil.monat !== undefined;
  const r = richtung(o);
  const passt = (d: Datum) => gibtEsTag(d) && !falschHerum(zeitpunktAm(d, u, o.zone), o);
  if (vollstaendig || r === 0 || passt(kandidat)) {
    return gibtEsTag(kandidat)
      ? { zeitpunkt: zeitpunktAm(kandidat, u, o.zone) }
      : { grund: GRUND.tag };
  }
  // Ohne Monat ein Monat weiter, ohne Jahr ein Jahr; der Tag des 31. kann mehrere Monate fehlen.
  const schritt = teil.monat === undefined ? 1 : 12;
  for (let n = 1; n <= 12; n += 1) {
    const weiter = monatVersetzt(kandidat, r * schritt * n);
    if (gibtEsTag(weiter)) return { zeitpunkt: zeitpunktAm(weiter, u, o.zone) };
  }
  return { grund: GRUND.tag };
}

function vollesDatum(d: Datum, u: Uhr, o: DeutungsOptionen): Ergebnis {
  if (d.monat < 1 || d.monat > 12) return { grund: GRUND.monat };
  if (!gibtEsTag(d)) return { grund: GRUND.tag };
  if (!gibtEsUhr(u)) return { grund: GRUND.uhrzeit };
  return { zeitpunkt: zeitpunktAm(d, u, o.zone) };
}

function lies(t: string, o: DeutungsOptionen): Ergebnis {
  const ohne = { stunde: 0, minute: 0, sekunde: 0 };
  if (o.nurTag) {
    const iso = ISO_TAG.exec(t);
    if (iso) return vollesDatum({ jahr: +iso[1], monat: +iso[2], tag: +iso[3] }, ohne, o);
    const de = DEUTSCH_TAG.exec(t);
    if (de) {
      const jahr = vollesJahr(de[3], datumAus(heuteInZone(o.zone, o.jetzt)).jahr);
      return vollesDatum({ jahr, monat: +de[2], tag: +de[1] }, ohne, o);
    }
    return { grund: GRUND.unlesbar };
  }

  if (t === 'j' || t === 'jetzt') return { zeitpunkt: o.jetzt };

  const rel = RELATIV.exec(t);
  if (rel) {
    const menge = Number(rel[2]) * (rel[3] === 'h' || rel[3] === 'std' ? 60 : 1);
    return { zeitpunkt: o.jetzt.add(rel[1] === '-' ? -menge : menge, 'minute') };
  }

  const uhr = UHRZEIT.exec(t);
  // Ohne Trenner nur 3 oder 4 Ziffern; „14“ ist keine Uhrzeit.
  if (uhr && (t.length >= 3 || /[:.]/.test(t))) {
    return ausUhrzeit({ stunde: +uhr[1], minute: +uhr[2], sekunde: 0 }, o);
  }

  const tu = TAG_UHRZEIT.exec(t);
  if (tu) {
    return ausTeilDatum({ tag: +tu[1] }, { stunde: +tu[2], minute: +tu[3], sekunde: 0 }, o);
  }

  const dtg = DTG.exec(t);
  if (dtg) {
    const monat = MONATSNAMEN[dtg[4]];
    if (!monat) return { grund: GRUND.monatsname };
    const u = { stunde: +dtg[2], minute: +dtg[3], sekunde: 0 };
    return ausTeilDatum(
      { tag: +dtg[1], monat, jahr: dtg[5] ? vollesJahr(dtg[5], 0) : undefined },
      u,
      o,
    );
  }

  const de = DEUTSCH.exec(t);
  if (de) {
    const u = { stunde: +de[4], minute: +de[5], sekunde: 0 };
    return ausTeilDatum(
      { tag: +de[1], monat: +de[2], jahr: de[3] ? vollesJahr(de[3], 0) : undefined },
      u,
      o,
    );
  }

  const iso = ISO.exec(t);
  if (iso) {
    const u = { stunde: +iso[4], minute: +iso[5], sekunde: iso[6] ? +iso[6] : 0 };
    return vollesDatum({ jahr: +iso[1], monat: +iso[2], tag: +iso[3] }, u, o);
  }

  return { grund: GRUND.unlesbar };
}

/** Getippten Text als Zeitpunkt deuten; leer = kein Zeitpunkt. */
export function deuteZeit(text: string, o: DeutungsOptionen): Deutung {
  const t = text.trim().toLowerCase().replace(/−/g, '-').replace(/\s+/g, ' ');
  if (t === '') return { ok: true, zeitpunkt: null };

  const e = lies(t, o);
  if ('grund' in e) return { ok: false, grund: e.grund };

  const tag = tagInZone(e.zeitpunkt, o.zone);
  const heute = heuteInZone(o.zone, o.jetzt);
  if (o.keineZukunftstage && tag > heute) return { ok: false, grund: GRUND.zukunft };
  const hinweis =
    tag === tagVersetzt(heute, -1) ? 'gestern' : tag === naechsterTag(heute) ? 'morgen' : undefined;
  return { ok: true, zeitpunkt: e.zeitpunkt, ...(hinweis ? { hinweis } : {}) };
}
