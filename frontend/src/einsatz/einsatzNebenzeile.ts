import type { EinsatzAnzeige } from '../api/types';
import { einsatzKennung } from './einsatzKennung';
import { EINSATZART_LABELS, isUebung } from './einsatzart';

/**
 * Nebenzeile eines Einsatzes in Wechsellisten (LLH-1821, Change `frgky8qr-einsatzwechsel-modul`,
 * D2; Spec `seiten-orientierung`): „Einsatzart · Nummer · Ort“, soweit vorhanden. Bei einer Übung
 * entfällt die Art, die Übungsmarke nennt sie schon. Rein, damit Wechsler und Palette dieselbe
 * Zeile zeigen können. `null`, wenn nichts davon vorliegt.
 */
export function einsatzNebenzeile(
  e: Pick<
    EinsatzAnzeige,
    'einsatzart' | 'einsatznummer_intern' | 'leitstellen_nr' | 'einsatzort'
  >,
): string | null {
  // Art aus der Tabelle; ein Einsatz ohne Art (Altbestand) bekommt keine.
  const art = isUebung(e) || !e.einsatzart ? null : (EINSATZART_LABELS[e.einsatzart] ?? null);
  const teile = [art, einsatzKennung(e), e.einsatzort?.trim()].filter((t): t is string => !!t);
  return teile.length > 0 ? teile.join(' · ') : null;
}
