import type {
  BetreuungsstelleArt,
  Erhebung,
  Evakuierungsbezirk,
  Raeumungszustand,
  Betreuungsstelle,
} from '../api/types';
import type { EvakuierungKennzahl } from './evakuierungKennzahl';

/**
 * Wortlaut und Zahlformat des Fachmoduls Betreuung (LFH-639), rein und exportiert.
 *
 * Die Zahlen stehen hier und nicht in der Seite, weil zwei Leser sie brauchen: die
 * Bezirkskarte („1 320 · von 1 850 geplant") und die Kennzahl im Lagebild (LFH-607). Zwei
 * Formatierer für dieselbe Aussage wären der Unterschied ohne Bedeutung, den niemand sieht,
 * bis Karte und Dashboard verschiedene Zahlen zu zeigen scheinen.
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
 * „davon namentlich n" an einer Stelle (LFH-674, design.md D7): Personen, die einzeln mit
 * Verbleib „Notunterkunft" hierher verbracht wurden. Ein HINWEIS neben der Mengenmeldung, nie
 * ein Summand — führend ist die Belegung. Ohne Belegungsmeldung entfällt „davon", weil es keine
 * Menge gibt, von der die Zahl ein Teil wäre. Bei 0 oder ohne Auskunft (kein Personenrecht:
 * das Feld fehlt in der Antwort) steht nichts.
 */
export function namentlichText(anzahl: number | undefined, gemeldet: boolean): string | null {
  if (!anzahl) return null;
  return `${gemeldet ? 'davon ' : ''}namentlich ${personenZahl(anzahl)}`;
}

/** „≈ 640" bei geschätzt, sonst „640". Das Zeichen ist der zweite Kanal der Erhebungsart. */
export function mengeText(n: number, erhebung: Erhebung): string {
  return erhebung === 'geschaetzt' ? `≈ ${personenZahl(n)}` : personenZahl(n);
}

/**
 * Die Hauptzeile einer Bezirkskarte: „N · von M geplant".
 *
 * Ohne Standmeldung steht „keine Meldung" statt 0 — „nichts gemeldet" ist nicht „niemand
 * evakuiert" (Spec, Kennzahl-Anforderung). N wird NICHT auf M gedeckelt.
 */
export function evakuiertText(
  b: Pick<Evakuierungsbezirk, 'stand' | 'plan_personen' | 'plan_erhebung'>,
): string {
  const n = b.stand ? mengeText(b.stand.evakuiert, b.stand.erhebung) : 'keine Meldung';
  return `${n} · von ${mengeText(b.plan_personen, b.plan_erhebung)} geplant`;
}

/**
 * Die Kennzahl „Evakuiert N · von M geplant" in ihren zwei Teilen — N und der Rest. Die
 * Dashboard-Zelle (LFH-607) setzt N als Wert und den Rest als Notiz, der Blockkopf der Seite
 * setzt beides in eine Zeile ({@link kennzahlText}). EINE Formatierung für beide Leser.
 *
 * Ist ein beteiligter Stand oder eine Plangröße geschätzt, trägt die Kennzahl ein „≈" (Spec
 * „Kennzahl"): vor N, solange es ein N gibt; ohne jede Meldung vor M — dann kann nur die
 * Plangröße geschätzt sein, und ohne das Zeichen wirkte sie gezählt. `evakuiert` ist dann
 * `null`: „nichts gemeldet" ist nicht „niemand evakuiert", der Aufrufer setzt sein eigenes
 * Wort statt einer 0. Bezirke ohne Meldung stehen in der Notiz, statt als 0 in N zu
 * verschwinden.
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
