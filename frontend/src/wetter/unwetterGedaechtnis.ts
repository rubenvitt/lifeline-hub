/**
 * Was dieser Browser einer Person zu einem Einsatz schon als Unwetter gemeldet hat (LFH-663,
 * `openspec/changes/lfh-663-unwetterwarnung-alarmbudget/design.md` D5).
 *
 * `localStorage`, weil ein Neuladen nicht erneut alarmieren darf und Tabs desselben Browsers
 * sich das Gedächtnis teilen sollen (der erste meldet, die anderen sehen das Paar schon). Die
 * Person steht im Schlüssel: auf einem Führungsrechner melden sich mehrere nacheinander an.
 * Ohne `localStorage` (privater Modus, Kontingent) fällt das Gedächtnis still auf den Tab
 * zurück — dann meldet ein Neuladen einmal mehr, verschluckt aber nichts.
 */
import type { WetterWarnstufe } from '../api/types';
import type { UnwetterGedaechtnis } from './unwetter';

export const GEDAECHTNIS_PRAEFIX = 'lifeline-unwetter-gemeldet';

const STUFEN: readonly WetterWarnstufe[] = ['gering', 'maessig', 'schwer', 'extrem'];

const rueckfall = new Map<string, UnwetterGedaechtnis>();

const schluessel = (benutzerId: number, einsatzId: number) =>
  `${GEDAECHTNIS_PRAEFIX}:${benutzerId}:${einsatzId}`;

/** Nur gültige Einträge; alles andere gilt als nie gemeldet. */
function bereinige(roh: unknown): UnwetterGedaechtnis {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) return {};
  const ergebnis: UnwetterGedaechtnis = {};
  for (const [paar, wert] of Object.entries(roh)) {
    const eintrag = wert as { stufe?: unknown; gesehenAt?: unknown } | null;
    if (
      eintrag &&
      STUFEN.includes(eintrag.stufe as WetterWarnstufe) &&
      typeof eintrag.gesehenAt === 'number' &&
      Number.isFinite(eintrag.gesehenAt)
    ) {
      ergebnis[paar] = { stufe: eintrag.stufe as WetterWarnstufe, gesehenAt: eintrag.gesehenAt };
    }
  }
  return ergebnis;
}

export function ladeGedaechtnis(benutzerId: number, einsatzId: number): UnwetterGedaechtnis {
  const s = schluessel(benutzerId, einsatzId);
  let roh: string | null;
  try {
    roh = localStorage.getItem(s);
  } catch {
    return rueckfall.get(s) ?? {};
  }
  if (roh == null) return rueckfall.get(s) ?? {};
  try {
    return bereinige(JSON.parse(roh));
  } catch {
    return {};
  }
}

export function speichereGedaechtnis(
  benutzerId: number,
  einsatzId: number,
  gedaechtnis: UnwetterGedaechtnis,
): void {
  const s = schluessel(benutzerId, einsatzId);
  try {
    localStorage.setItem(s, JSON.stringify(gedaechtnis));
  } catch {
    rueckfall.set(s, gedaechtnis);
  }
}

/** Nur für Tests: leert den Rückfall des Tabs. */
export function vergissRueckfall(): void {
  rueckfall.clear();
}
