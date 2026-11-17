import type { EinsatzAnzeige } from '../api/types';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { datum } from '../anzeige/zeitDarstellung';
import { einsatzKennung } from './einsatzKennung';
import { EINSATZART_LABELS, isUebung } from './einsatzart';

/**
 * Nebenzeile eines Einsatzes in Wechsellisten (LLH-1821, Change `frgky8qr-einsatzwechsel-modul`,
 * D2; Spec `seiten-orientierung`): „Einsatzart · Nummer · Ort“, soweit vorhanden. Bei einer Übung
 * entfällt die Art, die Übungsmarke nennt sie schon. Fehlt jede Nummer, steht an ihrer Stelle
 * „seit“ mit dem Beginndatum in der Zeitdarstellung der App (Rolle `datum`, keine eigene
 * Schreibweise). Rein, damit Wechsler und Palette dieselbe Zeile zeigen können. `null`, wenn
 * nichts davon vorliegt.
 */
export function einsatzNebenzeile(
  e: Pick<
    EinsatzAnzeige,
    'einsatzart' | 'einsatznummer_intern' | 'leitstellen_nr' | 'einsatzort' | 'begonnen_at'
  >,
  konv: AnzeigeKonventionen,
): string | null {
  // Art aus der Tabelle; ein Einsatz ohne Art (Altbestand) bekommt keine.
  const art = isUebung(e) || !e.einsatzart ? null : (EINSATZART_LABELS[e.einsatzart] ?? null);
  const beginn = datum(e.begonnen_at, konv);
  const nummer = einsatzKennung(e) ?? (beginn ? `seit ${beginn}` : null);
  const teile = [art, nummer, e.einsatzort?.trim()].filter((t): t is string => !!t);
  return teile.length > 0 ? teile.join(' · ') : null;
}
