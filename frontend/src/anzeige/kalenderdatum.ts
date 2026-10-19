/**
 * Kalenderdatum ohne Uhrzeit und Zone (LLH-1103, Spec `zeiteingabe`, „Kalenderdatum ohne Uhrzeit
 * und Zone“; Change `f8218h1i-personendaten-feldweise`, design.md D6), etwa das Geburtsdatum einer
 * Person.
 *
 * Ein Kalenderdatum ist KEIN Zeitpunkt: es wird ohne Anzeigezone gelesen, als `YYYY-MM-DD`
 * gespeichert und als „TT.MM.JJJJ“ gezeigt. Die Regel „Zeiteingabe in der Anzeigezone“
 * (`anzeige/zeitEingabe.ts`, `ZeitpunktEingabe`) gilt hier ausdrücklich nicht; es gibt weder
 * Schnellwahl noch relative Eingabe. Rein, ohne React, ohne Uhr und ohne `Date`: „heute“ reicht der
 * Aufrufer als Kalendertag der Anzeigezone herein (`heuteInZone(zone, serverJetzt())`), damit die
 * Zukunftsgrenze denselben Tag meint wie jede andere Anzeige.
 *
 * - **Schreibweisen:** „TT.MM.JJJJ“, „T.M.JJJJ“, „TT.MM.JJ“ (Tag und Monat ein- oder zweistellig)
 *   und `YYYY-MM-DD`; getrimmt, nur ASCII-Ziffern. Alles andere ist „nicht lesbar“ und wird nie
 *   erraten (wie `zeitParser.ts`, dessen Gründe hier gelten).
 * - **Zweistelliges Jahr** = das jüngste JAHR, das nicht in der Zukunft liegt: im Jahr 2026 ist
 *   „26“ 2026 und „27“ 1927. Liegt der Tag im laufenden Jahr nach heute, ist das eine Zukunft und
 *   kein Anlass, still ein Jahrhundert zurückzugehen.
 * - **Kalendergültigkeit** einschließlich 29.02. (gregorianisch, auch die 100/400-Regel).
 * - **Nicht nach heute.** Heute selbst ist erlaubt.
 */
import { GRUND } from './zeitParser';

export type KalenderdatumResult =
  | { ok: true; /** `YYYY-MM-DD`, oder `null` für eine leere Eingabe. */ datum: string | null }
  | { ok: false; grund: string };

const DEUTSCH = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{2}|[0-9]{4})$/;
const ISO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function isSchaltjahr(jahr: number): boolean {
  return (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
}

function tageImMonat(jahr: number, monat: number): number {
  if (monat === 2) return isSchaltjahr(jahr) ? 29 : 28;
  return [4, 6, 9, 11].includes(monat) ? 30 : 31;
}

function zweistellig(n: number): string {
  return String(n).padStart(2, '0');
}

function isoAus(jahr: number, monat: number, tag: number): string {
  return `${String(jahr).padStart(4, '0')}-${zweistellig(monat)}-${zweistellig(tag)}`;
}

/** Prüft Monat und Tag; `null`, wenn es den Tag gibt. */
function kalenderGrund(jahr: number, monat: number, tag: number): string | null {
  if (monat < 1 || monat > 12) return GRUND.monat;
  if (tag < 1 || tag > tageImMonat(jahr, monat)) return GRUND.tag;
  return null;
}

/**
 * Liest ein eingegebenes Kalenderdatum.
 *
 * @param text die Eingabe; leer (auch nur Leerraum) ergibt `{ ok: true, datum: null }`.
 * @param heute der heutige Kalendertag `YYYY-MM-DD` in der Anzeigezone.
 */
export function parseKalenderdatum(text: string, heute: string): KalenderdatumResult {
  const t = text.trim();
  if (t === '') return { ok: true, datum: null };

  let jahr: number;
  let monat: number;
  let tag: number;
  const iso = ISO.exec(t);
  const deutsch = iso ? null : DEUTSCH.exec(t);
  if (iso) {
    jahr = Number(iso[1]);
    monat = Number(iso[2]);
    tag = Number(iso[3]);
  } else if (deutsch) {
    tag = Number(deutsch[1]);
    monat = Number(deutsch[2]);
    jahr = Number(deutsch[3]);
    if (deutsch[3].length === 2) {
      const heuteJahr = Number(heute.slice(0, 4));
      jahr += Math.floor(heuteJahr / 100) * 100;
      if (jahr > heuteJahr) jahr -= 100;
    }
  } else {
    return { ok: false, grund: GRUND.unlesbar };
  }

  const grund = kalenderGrund(jahr, monat, tag);
  if (grund) return { ok: false, grund };
  const datum = isoAus(jahr, monat, tag);
  // `YYYY-MM-DD` mit vierstelligem Jahr sortiert als Text wie als Datum.
  if (datum > heute) return { ok: false, grund: GRUND.zukunft };
  return { ok: true, datum };
}

/**
 * Zeigt ein gespeichertes Kalenderdatum als „TT.MM.JJJJ“. Ein Wert, der kein gültiges
 * `YYYY-MM-DD` ist (Altbestand aus der Freitext-Zeit, „ca. 1980“), erscheint unverändert; leer
 * bleibt leer.
 */
export function formatKalenderdatum(wert: string | null | undefined): string {
  if (!wert) return '';
  const iso = ISO.exec(wert);
  if (!iso) return wert;
  const [jahr, monat, tag] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  if (kalenderGrund(jahr, monat, tag)) return wert;
  return `${iso[3]}.${iso[2]}.${iso[1]}`;
}
