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
 *  - **Datenstand** „Stand HH:MM" in der Anzeigezone, an einem anderen Tag als `jetzt` mit
 *    Tag davor („Stand 21. 23:50", {@link standZeit}). `zeitpunkt` ist RFC 3339 MIT Versatz —
 *    `inZone` liest ihn über `dayjs.utc`, das den Versatz auswertet; das Alter rechnet `Date.parse`, NICHT
 *    `wireAlsEpoche` (die hängt ein `Z` an und liefert für einen Versatz `NaN`).
 *  - **Älter als 60 min → „veraltet"**: Wort in der Notiz plus Ton `achtung` (Kante als
 *    zweiter Kanal). Die Quelle misst im 15-min-Raster; eine Stunde ohne neue Messung heißt,
 *    dass der Abruf scheitert und der Cache den alten Stand ausliefert.
 *  - **Ausfall** (festgelegt, aber keine Messung): Wert „—", Notiz „Stand unbekannt", Ton
 *    `achtung` — ein fehlender Pegel ist nicht harmloser als ein veralteter.
 *  - **Keiner festgelegt**: Wert „—", Notiz „kein Pegel festgelegt", Ton `neutral` — das ist
 *    kein Messzustand, sondern eine offene Einrichtung. Seit LFH-640 steht die Kennzahl im
 *    Lage-Dashboard nur bei festgelegtem Pegel; dieser Zweig greift dort nur noch, wenn der
 *    gehaltene Zuschnitt den Pegel zeigt, während er anderswo schon entfernt wurde.
 *  - **Mehrere**: Zusatz „+n weitere".
 *  - **Prognose** (LFH-628): trägt der Leitpegel einen erwarteten Höchststand, dessen
 *    Zeitpunkt noch vor `jetzt` liegt, steht er als eigener Teil „Prognose 7,10 m bis 18:00"
 *    hinter dem Datenstand — auch bei Ausfall der Messung, die Prognose ist eine eigene
 *    Angabe. Eine **abgelaufene** Prognose fällt aus der Kennzahl weg (Entscheidung des
 *    Auftraggebers vom 22.09.2026: vorbei ist nicht „überfällig"); in den Einstellungen steht
 *    sie als abgelaufen, bis jemand sie löscht oder erneuert. **Ohne Prognose ist die Notiz
 *    byte-gleich zur LFH-606-Fassung** — die Bestandstests pinnen das.
 */
import type { PegelAnzeige, PegelPrognose } from '../api/types';
import { DEFAULT_KONVENTIONEN, inZone, type AnzeigeKonventionen } from '../anzeige/format';

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

/**
 * Uhrzeit des Datenstands in der Anzeigezone: `HH:mm` am selben Tag wie `jetzt`, sonst
 * `DD. HH:mm`. Dasselbe Format wie `formatUhrzeitMitTag`, aber gegen `jetzt` statt gegen die
 * Maschinenuhr — sonst hinge das Tag-Präfix einer reinen Funktion an der echten Uhr und wäre
 * nicht pinnbar. Die Tagesgrenze liegt in derselben Zone wie die Formatierung. Rein.
 */
export function standZeit(
  zeitpunkt: string,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  const d = inZone(zeitpunkt, konv);
  const heute = inZone(new Date(jetzt).toISOString(), konv);
  return d.isSame(heute, 'day') ? d.format('HH:mm') : d.format('DD. HH:mm');
}

/** Messzeitpunkt (RFC 3339 mit Versatz) als Epoche; `NaN` bei Unlesbarem. Rein. */
export function messEpoche(zeitpunkt: string): number {
  return Date.parse(zeitpunkt);
}

/** Wire-Zeit der Prognose (UTC ohne Zonenkennung, `YYYY-MM-DD HH:MM:SS`) als Epoche; `NaN`
 *  bei Unlesbarem. Rein. */
export function prognoseEpoche(zeitpunkt: string): number {
  return Date.parse(`${zeitpunkt.trim().replace(' ', 'T')}Z`);
}

/** Ist die Prognose noch offen (Zeitpunkt nach `jetzt`)? Unlesbar zählt als abgelaufen. Rein. */
export function prognoseOffen(p: PegelPrognose, jetzt: number): boolean {
  const t = prognoseEpoche(p.zeitpunkt);
  return Number.isFinite(t) && t > jetzt;
}

/**
 * „Prognose 7,10 m bis 18:00" — am anderen Tag mit Tag davor („bis 23. 06:00"), in der
 * Anzeigezone wie der Datenstand. Rein.
 */
export function prognoseText(
  p: PegelPrognose,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return `Prognose ${wasserstandMeter(p.hoechststand_cm)} m bis ${standZeit(p.zeitpunkt, jetzt, konv)}`;
}

/** Prognose-Teil der Notiz, nur solange sie offen ist. */
function prognoseTeil(leit: PegelAnzeige, jetzt: number, konv: AnzeigeKonventionen): string[] {
  const p = leit.prognose;
  return p && prognoseOffen(p, jetzt) ? [prognoseText(p, jetzt, konv)] : [];
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

/**
 * Eine Station für sich (Modulseite „Wetter & Pegel“, LFH-633): dieselben Regeln wie die
 * Kennzahl — Meter, Trendwort, Stand, „veraltet“ ab 60 min, „Stand unbekannt“ bei Ausfall,
 * Prognose nur solange offen —, aber je Pegel statt nur für den Leitpegel. Die Kennzahl baut
 * auf dieser Ableitung auf, damit die Schwellen an genau einer Stelle stehen.
 */
export interface PegelZeile {
  fall: Exclude<PegelFall, 'keiner'>;
  name: string;
  gewaesser: string | null;
  wert: string;
  /** Nur im Fall `messung`. */
  einheit?: 'm';
  /** „steigend +9 cm/h" …; `null` bei Ausfall (dort gibt es keinen Trend, nicht „unbekannt"). */
  trend: string | null;
  richtung: TrendRichtung | null;
  /** „Stand 14:05" bzw. bei Ausfall „Stand unbekannt". */
  stand: string;
  veraltet: boolean;
  ton: 'neutral' | 'achtung';
  /** „Prognose 7,10 m bis 18:00", solange sie offen ist, sonst `null`. */
  prognose: string | null;
}

/** Ableitung für EINE Station. Rein. */
export function pegelZeile(
  p: PegelAnzeige,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): PegelZeile {
  const kopf = {
    name: p.name,
    gewaesser: p.gewaesser?.trim() || null,
    prognose: prognoseTeil(p, jetzt, konv)[0] ?? null,
  };
  const m = leitmessung(p, jetzt);
  if (!m) {
    return {
      ...kopf,
      fall: 'ausfall',
      wert: '—',
      trend: null,
      richtung: null,
      stand: PEGEL_STAND_UNBEKANNT,
      veraltet: false,
      ton: 'achtung',
    };
  }
  return {
    ...kopf,
    fall: 'messung',
    wert: m.meter,
    einheit: 'm',
    trend: trendText(m.trend),
    richtung: trendRichtung(m.trend),
    stand: `Stand ${standZeit(m.zeitpunkt, jetzt, konv)}`,
    veraltet: m.veraltet,
    ton: m.veraltet ? 'achtung' : 'neutral',
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
  const z = pegelZeile(leit, jetzt, konv);
  const ort = z.gewaesser ?? z.name;
  const weitere = pegel.length > 1 ? [`+${pegel.length - 1} weitere`] : [];
  const prognose = z.prognose ? [z.prognose] : [];
  if (z.fall === 'ausfall') {
    return {
      fall: 'ausfall',
      wert: z.wert,
      notiz: [ort, z.stand, ...prognose, ...weitere].join(' · '),
      ton: z.ton,
      veraltet: false,
    };
  }
  return {
    fall: 'messung',
    wert: z.wert,
    einheit: z.einheit,
    notiz: [
      ort,
      z.trend ?? TREND_UNBEKANNT,
      z.stand,
      ...(z.veraltet ? [VERALTET] : []),
      ...prognose,
      ...weitere,
    ].join(' · '),
    ton: z.ton,
    veraltet: z.veraltet,
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
