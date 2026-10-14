import type { AdhocEingabe, AngabenPatch } from '../api/einsatzFahrzeuge';
import type { EinsatzFahrzeug } from '../api/types';

/** Ein Feld der Ad-hoc-Angaben; die Schlüssel sind die Wire-Felder von POST und PATCH. */
export type AdhocFeld = keyof AdhocEingabe;

const OPTIONALE: readonly Exclude<AdhocFeld, 'funkrufname'>[] = [
  'fahrzeugtyp',
  'traegerorganisation',
  'kennzeichen',
  'opta',
];

/** Vorbelegung des Dialogs „Angaben ändern“ aus der Zeile (design.md D7). */
export function angabenVon(ef: EinsatzFahrzeug): AdhocEingabe {
  return {
    funkrufname: ef.funkrufname,
    fahrzeugtyp: ef.fahrzeugtyp ?? undefined,
    traegerorganisation: ef.traegerorganisation ?? undefined,
    kennzeichen: ef.kennzeichen ?? undefined,
    opta: ef.opta ?? undefined,
  };
}

const getrimmt = (w: string | null | undefined) => w?.trim() ?? '';

/**
 * Nur, was sich gegenüber der Zeile geändert hat (design.md D7): verglichen getrimmt, ein leeres
 * optionales Feld als `null` (Leeren). Ein leeres Objekt heißt „nichts geändert“ — dann geht keine
 * Anfrage hinaus. Der Funkrufname ist Pflicht; leer prüft ihn das Formular, nicht diese Funktion.
 */
export function buildAngabenPatch(ef: EinsatzFahrzeug, werte: AdhocEingabe): AngabenPatch {
  const patch: AngabenPatch = {};
  const funkrufname = getrimmt(werte.funkrufname);
  if (funkrufname !== getrimmt(ef.funkrufname)) patch.funkrufname = funkrufname;
  for (const f of OPTIONALE) {
    const neu = getrimmt(werte[f]);
    if (neu !== getrimmt(ef[f])) patch[f] = neu === '' ? null : neu;
  }
  return patch;
}

/** Liegt ein Feld mit Prüffehler im Klappteil? Dann geht er auf (`onPruefungGescheitert`). */
export function hasFehlerIn(
  felder: readonly AdhocFeld[],
  fehlerFelder: readonly string[],
): boolean {
  return fehlerFelder.some((f) => (felder as readonly string[]).includes(f));
}
