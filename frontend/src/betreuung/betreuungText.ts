import type {
  BetreuungsstelleArt,
  Erhebung,
  Evakuierungsbezirk,
  Raeumungszustand,
  Betreuungsstelle,
} from '../api/types';
import { auslastung } from '../theme/statusFarben';
import type { EvakuierungKennzahl } from './evakuierungKennzahl';

/**
 * Wortlaut und Zahlformat des Fachmoduls Betreuung, rein und exportiert — eine Formatierung für
 * Bezirkskarte und Lage-Dashboard.
 */

/** Schmales geschütztes Leerzeichen: Tausendertrenner (DIN 5008), bricht nicht um. */
const TRENNER = ' ';

/** „1 320" — ganzzahlig, Tausender durch ein schmales geschütztes Leerzeichen getrennt. */
export function personenZahl(n: number): string {
  const vorzeichen = n < 0 ? '-' : '';
  const ziffern = String(Math.abs(Math.trunc(n)));
  return vorzeichen + ziffern.replace(/\B(?=(\d{3})+(?!\d))/g, TRENNER);
}

/**
 * „davon namentlich n": einzeln mit Verbleib „Notunterkunft" hierher verbrachte Personen. Ein
 * HINWEIS neben der Mengenmeldung, nie ein Summand. Ohne Belegungsmeldung entfällt „davon"; bei
 * 0 oder ohne Personenrecht (Feld fehlt) steht nichts. Wort und Zahl kommen getrennt zurück,
 * weil nur die Zahl Mono mit `tabular-nums` läuft.
 */
export function namentlichTeile(
  anzahl: number | undefined,
  gemeldet: boolean,
): { wort: string; zahl: string } | null {
  if (!anzahl) return null;
  return { wort: gemeldet ? 'davon namentlich' : 'namentlich', zahl: personenZahl(anzahl) };
}

/** „≈ 640" bei geschätzt, sonst „640". Das Zeichen ist der zweite Kanal der Erhebungsart. */
export function mengeText(n: number, erhebung: Erhebung): string {
  return erhebung === 'geschaetzt' ? `≈ ${personenZahl(n)}` : personenZahl(n);
}

/**
 * Die Hauptzeile einer Bezirkskarte: „N · von M geplant".
 * Ohne Standmeldung „keine Meldung" statt 0 — „nichts gemeldet" ist nicht „niemand evakuiert".
 * N wird NICHT auf M gedeckelt.
 */
export function evakuiertText(
  b: Pick<Evakuierungsbezirk, 'stand' | 'plan_personen' | 'plan_erhebung'>,
): string {
  const n = b.stand ? mengeText(b.stand.evakuiert, b.stand.erhebung) : 'keine Meldung';
  return `${n} · von ${mengeText(b.plan_personen, b.plan_erhebung)} geplant`;
}

/**
 * Die Kennzahl „Evakuiert N · von M geplant" in zwei Teilen — N und der Rest (Dashboard-Zelle:
 * Wert und Notiz; Blockkopf: eine Zeile über {@link kennzahlText}).
 *
 * Ist ein beteiligter Stand oder eine Plangröße geschätzt, steht „≈" vor N bzw. ohne jede
 * Meldung vor M. `evakuiert` ist ohne Meldung `null` — der Aufrufer setzt sein eigenes Wort
 * statt einer 0. Bezirke ohne Meldung stehen in der Notiz.
 */
export function kennzahlTeile(k: EvakuierungKennzahl): { evakuiert: string | null; notiz: string } {
  const ca = k.geschaetzt ? '≈ ' : '';
  const n = k.evakuiert == null ? null : `${ca}${personenZahl(k.evakuiert)}`;
  const m = n == null ? `${ca}${personenZahl(k.geplant)}` : personenZahl(k.geplant);
  const ohne = k.ohneMeldung > 0 ? ` · ${personenZahl(k.ohneMeldung)} ohne Meldung` : '';
  return { evakuiert: n, notiz: `von ${m} geplant${ohne}` };
}

/** Die Kennzahl als eine Zeile für den Blockkopf der Seite; ohne Meldung „keine Meldung". */
export function kennzahlText(k: EvakuierungKennzahl | null): string {
  if (k == null) return 'keine geplante Evakuierung';
  const { evakuiert, notiz } = kennzahlTeile(k);
  return `${evakuiert ?? 'keine Meldung'} · ${notiz}`;
}

/** Freie Plätze — `null` ohne Kapazität (Spec: „keine Zahl freier Plätze") oder ohne Meldung. */
export function freiePlaetze(
  s: Pick<Betreuungsstelle, 'kapazitaet_personen' | 'belegung'>,
): number | null {
  if (s.kapazitaet_personen == null || s.belegung == null) return null;
  return s.kapazitaet_personen - s.belegung.belegt;
}

/**
 * Zahl der Stellen, die „voll" oder „überbelegt" sind (Rolle `alarm`); „fast voll" zählt nicht.
 * Abgeleitet aus {@link auslastung}, damit Kopfzahl und Wort in der Spalte „belegt" nicht
 * auseinanderlaufen. Eine geschlossene Stelle ist nie voll (schließen nur bei Belegung 0).
 */
export function volleStellen(
  stellen: readonly Pick<Betreuungsstelle, 'kapazitaet_personen' | 'belegung'>[],
): number {
  return stellen.filter(
    (s) => auslastung(s.belegung?.belegt, s.kapazitaet_personen)?.rolle === 'alarm',
  ).length;
}

/** „ · 2 voll" zum Anhängen an eine Kopfzeile; bei 0 leer — kein „0 voll". */
export function volleStellenSegment(
  stellen: readonly Pick<Betreuungsstelle, 'kapazitaet_personen' | 'belegung'>[],
): string {
  const n = volleStellen(stellen);
  return n > 0 ? ` · ${personenZahl(n)} voll` : '';
}

export const ERHEBUNG_LABEL: Record<Erhebung, string> = {
  gezaehlt: 'gezählt',
  geschaetzt: 'geschätzt',
};

export const ART_LABEL: Record<BetreuungsstelleArt, string> = {
  anlaufstelle: 'Anlaufstelle',
  betreuungsstelle: 'Betreuungsstelle',
  betreuungsplatz: 'Betreuungsplatz',
  notunterkunft: 'Notunterkunft',
};

/** Reihenfolge der Räumungszustände in Auswahl und Filter (Ablauf, nicht Alphabet). */
export const RAEUMUNG_FOLGE: readonly Raeumungszustand[] = [
  'angeordnet',
  'laeuft',
  'geraeumt',
  'aufgehoben',
];
