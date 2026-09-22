/**
 * Die Pegel-Kennzahl (LFH-606) — reine Ableitung aus der Liste der maßgeblichen Pegel.
 *
 * EINE Quelle für zwei Leser: das Kennzahlenband des Lage-Dashboards (Platz 1, lange Notiz)
 * und die Warnstufen-Kennzahl des Überblicks (kurze Notiz „Pegel 6,84 m steigend"). Die Datei
 * liegt deshalb weder unter `lage-dashboard/` noch unter `fuehrung/`: eine Seite, die aus dem
 * Verzeichnis einer anderen Seite importiert, wäre eine neue Querabhängigkeit.
 *
 * Leitpegel ist der ERSTE in der Reihenfolge (`reihenfolge` 0, das Backend liefert sortiert).
 *
 * Festlegungen, jede in `pegelKennzahl.test.ts` gepinnt:
 *
 *  - **Wert in Metern, zwei Nachkommastellen, deutsches Komma** („6,84"). Die W-Reihe der
 *    Quelle ist in cm; eine Kennzahl liest man als Meter an der Pegellatte. Die Einheit bleibt
 *    auch unter `einheiten: 'imperial'` Meter: das Einheiten-System der Anzeige-Konventionen
 *    gilt für abgeleitete Strecken (Distanzen), nicht für einen amtlichen Messwert, dessen
 *    Meldestufen in Metern/Zentimetern geführt werden — ein Pegel in Fuß wäre mit keiner
 *    Hochwassermeldung vergleichbar.
 *  - **Trend auf ganze cm/h gerundet**, Richtung als WORT (zweiter Kanal, WCAG 1.4.1):
 *    „steigend +9 cm/h", „fallend −3 cm/h" (echtes Minuszeichen U+2212), „gleichbleibend"
 *    bei |Trend| < 1 cm/h, „Trend unbekannt" ohne Trend. Das Backend rundet auf eine
 *    Nachkommastelle; Zehntel-Zentimeter je Stunde sind in einer Kennzahl Rauschen, und die
 *    Rundung auf ganze Zahlen passt zur Schwelle für „gleichbleibend".
 *  - **Datenstand** „Stand HH:MM" in der Anzeigezone über `formatUhrzeitMitTag` (am Vortag
 *    mit Tag davor). `zeitpunkt` ist RFC 3339 MIT Versatz — `inZone` liest ihn über
 *    `dayjs.utc`, das den Versatz auswertet; das Alter rechnet `Date.parse`, NICHT
 *    `wireAlsEpoche` (die hängt ein `Z` an und liefert für einen Versatz `NaN`).
 *  - **Älter als 60 min → „veraltet"**: Wort in der Notiz plus Ton `achtung` (Kante als
 *    zweiter Kanal). Die Quelle misst im 15-min-Raster; eine Stunde ohne neue Messung heißt,
 *    dass der Abruf scheitert und der Cache den alten Stand ausliefert.
 *  - **Ausfall** (festgelegt, aber keine Messung): Wert „—", Notiz „Stand unbekannt", Ton
 *    `achtung` — ein fehlender Pegel ist nicht harmloser als ein veralteter.
 *  - **Keiner festgelegt**: Wert „—", Notiz „kein Pegel festgelegt", Ton `neutral` — das ist
 *    kein Messzustand, sondern eine offene Einrichtung (die Seite verlinkt die Auswahl).
 *  - **Mehrere**: Zusatz „+n weitere".
 */
import type { PegelAnzeige } from '../api/types';
import {
  DEFAULT_KONVENTIONEN,
  formatUhrzeitMitTag,
  type AnzeigeKonventionen,
} from '../anzeige/format';

/** Ab diesem Alter ist eine Messung „veraltet". */
export const PEGEL_VERALTET_MS = 60 * 60_000;

export const KEIN_PEGEL = 'kein Pegel festgelegt';
export const PEGEL_STAND_UNBEKANNT = 'Stand unbekannt';
export const TREND_UNBEKANNT = 'Trend unbekannt';
export const VERALTET = 'veraltet';

/** Echtes Minuszeichen (U+2212) — der Bindestrich ist kein Rechenzeichen. */
const MINUS = '−';

const METER = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** Wasserstand in cm → Meter mit zwei Nachkommastellen („684" → „6,84"). Rein. */
export function wasserstandMeter(cm: number): string {
  const text = METER.format(cm / 100);
  // `-0,00` gibt es nicht; ein negativer Pegelstand (Pegelnull über der Sohle) trägt das
  // echte Minuszeichen wie der Trend.
  if (/^-0,00$/.test(text)) return '0,00';
  return text.replace(/^-/, MINUS);
}

export type TrendRichtung = 'steigend' | 'fallend' | 'gleichbleibend';

/** Richtung aus dem Trend in cm/h; `null` ohne Trend. |t| < 1 ist gleichbleibend. Rein. */
export function trendRichtung(t: number | null | undefined): TrendRichtung | null {
  if (t == null || !Number.isFinite(t)) return null;
  if (Math.abs(t) < 1) return 'gleichbleibend';
  return t > 0 ? 'steigend' : 'fallend';
}

/** „steigend +9 cm/h" · „fallend −3 cm/h" · „gleichbleibend" · „Trend unbekannt". Rein. */
export function trendText(t: number | null | undefined): string {
  const richtung = trendRichtung(t);
  if (richtung == null) return TREND_UNBEKANNT;
  if (richtung === 'gleichbleibend') return richtung;
  const betrag = Math.round(Math.abs(t as number));
  return `${richtung} ${richtung === 'steigend' ? '+' : MINUS}${betrag} cm/h`;
}

/** Messzeitpunkt (RFC 3339 mit Versatz) als Epoche; `NaN` bei Unlesbarem. Rein. */
export function messEpoche(zeitpunkt: string): number {
  return Date.parse(zeitpunkt);
}

/** Der Fall, den die Kennzahl zeigt — für Aufrufer, die daran ein Ziel oder einen Ton hängen. */
export type PegelFall = 'messung' | 'ausfall' | 'keiner';

export interface PegelKennzahl {
  fall: PegelFall;
  wert: string;
  einheit?: string;
  notiz: string;
  ton: 'neutral' | 'achtung';
  /** Nur im Fall `messung`: älter als {@link PEGEL_VERALTET_MS}. */
  veraltet: boolean;
}

interface Leitmessung {
  meter: string;
  trend: number | null | undefined;
  veraltet: boolean;
  zeitpunkt: string;
}

/** Leitpegel und seine brauchbare Messung (unlesbarer Zeitpunkt zählt als Ausfall). */
function leitmessung(leit: PegelAnzeige, jetzt: number): Leitmessung | null {
  const m = leit.messung;
  if (!m) return null;
  const epoche = messEpoche(m.zeitpunkt);
  if (!Number.isFinite(epoche) || !Number.isFinite(m.wasserstand_cm)) return null;
  return {
    meter: wasserstandMeter(m.wasserstand_cm),
    trend: m.trend_cm_pro_h,
    veraltet: jetzt - epoche > PEGEL_VERALTET_MS,
    zeitpunkt: m.zeitpunkt,
  };
}

/** Kennzahl für das Band des Lage-Dashboards. `pegel` in Reihenfolge, erster = Leitpegel. Rein. */
export function pegelKennzahl(
  pegel: readonly PegelAnzeige[],
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): PegelKennzahl {
  const leit = pegel[0];
  if (!leit) {
    return { fall: 'keiner', wert: '—', notiz: KEIN_PEGEL, ton: 'neutral', veraltet: false };
  }
  const ort = leit.gewaesser?.trim() || leit.name;
  const weitere = pegel.length > 1 ? [`+${pegel.length - 1} weitere`] : [];
  const m = leitmessung(leit, jetzt);
  if (!m) {
    return {
      fall: 'ausfall',
      wert: '—',
      notiz: [ort, PEGEL_STAND_UNBEKANNT, ...weitere].join(' · '),
      ton: 'achtung',
      veraltet: false,
    };
  }
  const stand = `Stand ${formatUhrzeitMitTag(m.zeitpunkt, konv)}`;
  return {
    fall: 'messung',
    wert: m.meter,
    einheit: 'm',
    notiz: [ort, trendText(m.trend), stand, ...(m.veraltet ? [VERALTET] : []), ...weitere].join(
      ' · ',
    ),
    ton: m.veraltet ? 'achtung' : 'neutral',
    veraltet: m.veraltet,
  };
}

/**
 * Kurze Notiz für die Warnstufen-Kennzahl des Überblicks: „Pegel 6,84 m steigend".
 * Ohne festgelegten Pegel `null` (keine Notiz), bei Ausfall „Pegel: Stand unbekannt". Ein
 * veralteter Stand trägt „· veraltet" — das Wort ist hier der einzige Kanal, die Kennzahl
 * gehört der Warnstufe und färbt sich nicht nach dem Pegel. Rein.
 */
export function pegelNotizKurz(pegel: readonly PegelAnzeige[], jetzt: number): string | null {
  const leit = pegel[0];
  if (!leit) return null;
  const m = leitmessung(leit, jetzt);
  if (!m) return `Pegel: ${PEGEL_STAND_UNBEKANNT}`;
  const richtung = trendRichtung(m.trend);
  const kern = `Pegel ${m.meter} m${richtung ? ` ${richtung}` : ''}`;
  return m.veraltet ? `${kern} · ${VERALTET}` : kern;
}
