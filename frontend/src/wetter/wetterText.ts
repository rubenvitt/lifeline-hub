/**
 * Reine Textbausteine der Wetter-Paneele. Jede Angabe trägt ihre Einheit, ein fehlender Wert
 * erscheint als Strich — nie als 0. Deutsches Komma, Minus als U+2212.
 */
import type { WetterErgaenzung, WetterMessgroesse, WetterSymbol } from '../api/types';
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../anzeige/format';
import { standZeit } from '../pegel/pegelKennzahl';
import { himmelsrichtung } from './wetterStand';

const FEHLT = '—';
const MINUS = '−';

const EINE_STELLE = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
});
const GANZ = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, useGrouping: false });

const zahl = (fmt: Intl.NumberFormat, v: number) => fmt.format(v).replace(/^-/, MINUS);
const da = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/**
 * Versalien der Quelle („ORKANARTIGE BÖEN", „BREMEN") → „Orkanartige Böen". Gemischte
 * Schreibung (SYNOP-Namen wie „Bremen (Buergerpark)", „Frankfurt/Main") bleibt stehen. Rein.
 */
export function titelSchreibung(text: string): string {
  const t = text.trim();
  if (/\p{Ll}/u.test(t)) return t;
  return t
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
 * „aus S 11 km/h · Böen 19 km/h" — Richtung als Wort, kein Pfeil. „aus —" bleibt als fehlend
 * lesbar; ein nackter Strich vor der Zahl läse sich wie ein Minus.
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
 * (angekündigt); am anderen Tag mit Tag davor ({@link standZeit}). `zeit` ersetzt die Uhrzeit,
 * etwa durch die DTG im Lagevortrag (LFH-872). Rein.
 */
export function warnZeitraum(
  beginn: string | null | undefined,
  ende: string | null | undefined,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
  zeit: (zeitpunkt: string) => string = (z) => standZeit(z, jetzt, konv),
): string {
  const teile: string[] = [];
  const b = beginn ? Date.parse(beginn) : Number.NaN;
  if (Number.isFinite(b)) {
    teile.push(`${b > jetzt ? 'ab' : 'seit'} ${zeit(beginn as string)}`);
  }
  const e = ende ? Date.parse(ende) : Number.NaN;
  teile.push(Number.isFinite(e) ? `bis ${zeit(ende as string)}` : 'bis auf Weiteres');
  return teile.join(' · ');
}

// ── Aktuelle Bedingungen (LFH-864) ───────────────────────────────────────────────

/** Zahl ohne Einheit für eine Kennzahl („15,3", „17", „−0,4"); fehlend „—". Rein. */
export function zahlText(v: number | null | undefined, stellen: 0 | 1): string {
  if (!da(v)) return FEHLT;
  return zahl(stellen === 1 ? EINE_STELLE : GANZ, v);
}

/** Sichtweite: „180 m" · „53,2 km"; fehlend „—". Rein. */
export function sichtText(meter: number | null | undefined): string {
  return entfernungText(meter) ?? FEHLT;
}

/** „80 %"; fehlend „—". Rein. */
export function prozentText(p: number | null | undefined): string {
  return da(p) ? `${GANZ.format(p)} %` : FEHLT;
}

/** Luftdruck ganzzahlig: „1021 hPa"; fehlend „—". Rein. */
export function druckText(hpa: number | null | undefined): string {
  return da(hpa) ? `${GANZ.format(hpa)} hPa` : FEHLT;
}

/** Ein Wort je Wetterlage; Tag und Nacht unterscheidet nur das Icon (design.md D5). */
const SYMBOL_WORT: Record<WetterSymbol, string> = {
  klar_tag: 'klar',
  klar_nacht: 'klar',
  teils_bewoelkt_tag: 'teils bewölkt',
  teils_bewoelkt_nacht: 'teils bewölkt',
  bewoelkt: 'bewölkt',
  nebel_tag: 'Nebel',
  nebel_nacht: 'Nebel',
  wind: 'windig',
  regen: 'Regen',
  schneeregen: 'Schneeregen',
  schnee: 'Schnee',
  hagel: 'Hagel',
  gewitter: 'Gewitter',
};

/** Wort der Wetterlage; ohne (unbekannte) Wetterlage „—". Rein. */
export function wetterSymbolWort(s: WetterSymbol | null | undefined): string {
  return s ? SYMBOL_WORT[s] : FEHLT;
}

/**
 * Herkunft eines Werts aus einer anderen als der Station im Kopf: „Station Hameln, 12,1 km";
 * stammt er von der Kopf-Station, `null`. Rein.
 */
export function ergaenztVon(
  ergaenzt: readonly WetterErgaenzung[],
  groesse: WetterMessgroesse,
): string | null {
  const e = ergaenzt.find((x) => x.groessen.includes(groesse));
  return e ? stationText(e.station.name, e.station.entfernung_m) : null;
}
