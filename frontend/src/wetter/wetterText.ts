/**
 * Reine Textbausteine der Wetter-Paneele (LFH-633). Jede Angabe trägt ihre Einheit, und ein
 * Wert, den die Quelle nicht liefert, erscheint als Strich — nie als 0 (Spec „Fehlender
 * Einzelwert"). Zahlen mit deutschem Komma, negatives Vorzeichen als echtes Minus (U+2212)
 * wie beim Pegel.
 */
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { standZeit } from '../pegel/pegelKennzahl';
import { himmelsrichtung } from './wetterStand';

export const FEHLT = '—';
const MINUS = '−';

const EINE_STELLE = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
});
const GANZ = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, useGrouping: false });

const zahl = (fmt: Intl.NumberFormat, v: number) => fmt.format(v).replace(/^-/, MINUS);
const da = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Versalien der Quelle („ORKANARTIGE BÖEN", „BREMEN") → „Orkanartige Böen". Rein. */
export function titelSchreibung(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase('de-DE')
    .replace(
      /(^|[\s-])(\p{L})/gu,
      (_, vor: string, b: string) => vor + b.toLocaleUpperCase('de-DE'),
    );
}

/** „850 m" · „4,2 km"; ohne Wert `null`. Rein. */
export function entfernungText(meter: number | null | undefined): string | null {
  if (!da(meter)) return null;
  return meter < 1000 ? `${GANZ.format(meter)} m` : `${zahl(EINE_STELLE, meter / 1000)} km`;
}

/** „Station Bremen, 4,2 km"; ohne Station `null`. Rein. */
export function stationText(
  station: string | null | undefined,
  entfernungM: number | null | undefined,
): string | null {
  if (!station?.trim()) return null;
  const e = entfernungText(entfernungM);
  return `Station ${titelSchreibung(station)}${e ? `, ${e}` : ''}`;
}

export function temperaturText(c: number | null | undefined): string {
  return da(c) ? `${zahl(EINE_STELLE, c)} °C` : FEHLT;
}

/** „0,0 mm · 20 %" — Menge und Wahrscheinlichkeit, jede für sich fehlend markiert. */
export function niederschlagText(
  mm: number | null | undefined,
  prozent: number | null | undefined,
): string {
  const menge = da(mm) ? `${zahl(EINE_STELLE, mm)} mm` : FEHLT;
  const p = da(prozent) ? `${GANZ.format(prozent)} %` : FEHLT;
  return `${menge} · ${p}`;
}

/**
 * „aus S 11 km/h · Böen 19 km/h" — Richtung als Wort (Herkunft), kein Pfeil-Bildzeichen.
 * Das „aus" trägt die Richtung auch dann, wenn sie fehlt: „aus —" ist als fehlend lesbar,
 * ein nackter Strich vor der Zahl läse sich wie ein Minus.
 */
export function windText(
  kmh: number | null | undefined,
  boeenKmh: number | null | undefined,
  grad: number | null | undefined,
): string {
  const richtung = himmelsrichtung(grad);
  const mittel = da(kmh) ? `${GANZ.format(kmh)} km/h` : FEHLT;
  const boeen = da(boeenKmh) ? `${GANZ.format(boeenKmh)} km/h` : FEHLT;
  return `aus ${richtung ?? FEHLT} ${mittel} · Böen ${boeen}`;
}

/**
 * Zeitraum einer Warnung: „seit 13:00 · bis 16:00" (gilt) bzw. „ab 17:00 · bis 20:00"
 * (angekündigt); am anderen Tag mit Tag davor ({@link standZeit}). Rein.
 */
export function warnZeitraum(
  beginn: string | null | undefined,
  ende: string | null | undefined,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  const teile: string[] = [];
  const b = beginn ? Date.parse(beginn) : Number.NaN;
  if (Number.isFinite(b)) {
    teile.push(`${b > jetzt ? 'ab' : 'seit'} ${standZeit(beginn as string, jetzt, konv)}`);
  }
  const e = ende ? Date.parse(ende) : Number.NaN;
  teile.push(
    Number.isFinite(e) ? `bis ${standZeit(ende as string, jetzt, konv)}` : 'bis auf Weiteres',
  );
  return teile.join(' · ');
}
