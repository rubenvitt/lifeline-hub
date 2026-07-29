import type { Person } from '../api/types';

/**
 * Filterkette der Personenliste als reine Funktionen (LFH-330 · B2, Muster
 * `pages/schaeden/schadenHelfer.tsx`).
 *
 * Warum überhaupt herausgezogen: die Kette lag als Ausdruck im Rumpf von `PersonenPage` und
 * war nur über einen gerenderten Reiter prüfbar. Als Funktion trägt sie eigene Tests, und
 * die Seite verdrahtet nur noch ihre Zustände.
 *
 * Was hier NICHT lebt: die Freitextsuche. Sie hängt am `suchText` der jeweiligen Spalte und
 * läuft im `Datensicht`-Primitiv über ALLE suchbaren Spalten — ein zweites Suchfeld auf der
 * Seite wäre eine zweite, still driftende Wahrheit. Von `SchaedenPage` übernommen ist nur
 * die *Semantik* der Kette, nicht ihr Suchanteil.
 */

/** Sicht-Reiter: 'alle' und 'patienten' filtern nicht; sonst Status-Filter. */
export type PersonenSicht =
  | 'erfasst'
  | 'vermisst'
  | 'betroffen'
  | 'patienten'
  | 'verstorben'
  | 'alle';

/**
 * Zeilenmenge eines Sicht-Reiters.
 *
 * `'patienten'` filtert bewusst NICHT: der Patienten-Reiter zeigt die SK-Achse als
 * Gruppierung über `istPatient` (`personen/personMeta.ts`), und beide Achsen in einer
 * Funktion zu bedienen verwischte, welche von ihnen die Zeilen bestimmt.
 */
export function filterPersonen(alle: readonly Person[], sicht: PersonenSicht): readonly Person[] {
  if (sicht === 'alle' || sicht === 'patienten') return alle;
  return alle.filter((p) => p.status === sicht);
}

/**
 * Die für einen Vermisst-Abgleich in Frage kommenden Personen: betroffen oder verstorben,
 * und nicht storniert.
 *
 * `!p.storniert_at` ist nicht Beiwerk — eine stornierte Person darf als Abgleichsziel nicht
 * angeboten werden, und ohne diese Bedingung stünde sie unauffällig in der Auswahlliste.
 */
export function gefundenePersonen(alle: readonly Person[]): readonly Person[] {
  return alle.filter(
    (p) => (p.status === 'betroffen' || p.status === 'verstorben') && !p.storniert_at,
  );
}
