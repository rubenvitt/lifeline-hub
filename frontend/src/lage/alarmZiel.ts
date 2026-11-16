/**
 * Sprungziele der Alarmzeile (LLH-1743, Spec `lage-alarmzeile`, „Sprung zur Stelle“, design.md
 * D9): je Art die Stelle, an der sie bearbeitet wird. Nennt der Eintrag genau eine Einheit oder
 * einen Abschnitt, springt er auf sie. Ein Ziel, das der Betrachter nicht öffnen darf, kommt
 * ohne Link (Lesart der Navigation: `istSprungGesperrt`).
 */
import type { ModulFreigaben } from '../api/types';
import { istSprungGesperrt } from '../einsatz/modulRegistry';
import {
  auftraegePfad,
  einsatzabschnittePfad,
  erinnerungenPfad,
  kraefteuebersichtPfad,
  meldungenPfad,
  nachforderungenPfad,
  personenPfad,
} from '../routing/deeplinks';
import type { AlarmArt, AlarmEintrag } from './wasBrennt';

/** Das Modul, dessen Seite das Ziel ist (Schlüssel wie in der Navigation). */
const ZIEL_MODUL: Record<AlarmArt, string> = {
  sofort: 'meldungen',
  bestaetigung: 'meldungen',
  dringend: 'meldungen',
  vermisst: 'personen',
  kritisch: 'einsatzabschnitte',
  rueckmeldung: 'kraefteuebersicht',
  ausfall: 'kraefteuebersicht',
  auftrag: 'auftraege',
  erinnerung: 'erinnerungen',
  nachforderung: 'nachforderungen',
};

function einzeln(bezug: readonly number[]): number | undefined {
  return bezug.length === 1 ? bezug[0] : undefined;
}

export function alarmZiel(
  e: Pick<AlarmEintrag, 'art' | 'bezug'>,
  einsatzId: number,
  freigaben: ModulFreigaben | undefined,
): string | undefined {
  if (istSprungGesperrt(ZIEL_MODUL[e.art], freigaben)) return undefined;
  switch (e.art) {
    case 'sofort':
    case 'bestaetigung':
    case 'dringend':
      return meldungenPfad(einsatzId);
    case 'vermisst':
      return personenPfad(einsatzId, { filter: 'vermisst' });
    case 'kritisch':
      return einsatzabschnittePfad(einsatzId, { abschnitt: einzeln(e.bezug) });
    case 'rueckmeldung':
    case 'ausfall':
      return kraefteuebersichtPfad(einsatzId, { einheit: einzeln(e.bezug) });
    case 'auftrag':
      return auftraegePfad(einsatzId);
    case 'erinnerung':
      return erinnerungenPfad(einsatzId);
    case 'nachforderung':
      return nachforderungenPfad(einsatzId);
  }
}
