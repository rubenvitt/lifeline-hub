import type {
  BesetzungArt,
  BesetzungBody,
  EinsatzStatus,
  Sachgebiet,
  Stab,
  Stabsfunktion,
} from '../api/types';
import type { StatusDarstellung } from '../theme/statusFarben';

/** „Nicht vergeben" ist KEIN Datensatz (keine Zeile vom Server), aber eine Wahl in der Maske. */
export type BesetzungWahl = BesetzungArt | 'nicht_vergeben';

export interface BesetzungFormWerte {
  art: BesetzungWahl;
  /**
   * `EinsatzPersonal.id` (= `einsatz_personal.id`), nicht `EinsatzPersonal.personal_id`.
   * `null` nach einer abgebrochenen Ad-hoc-Anlage — `required` weist es ab.
   */
  personal_id?: number | null;
  bezeichnung?: string;
}

/** „Nicht vergeben" steht auf ALLEN sechs Zeilen zur Wahl. */
export const BESETZUNG_OPTIONEN: readonly { value: BesetzungWahl; label: string }[] = [
  { value: 'nicht_vergeben', label: 'nicht vergeben' },
  { value: 'einsatzleitung', label: 'bei der Einsatzleitung' },
  { value: 'personal', label: 'disponierte Person' },
  { value: 'extern', label: 'extern (nicht disponiert)' },
  { value: 'rueckwaertig', label: 'rückwärtig (Leitstelle/FEZ)' },
];

export function zeileFuer(
  stab: Stab | undefined,
  sachgebiet: Sachgebiet,
): Stabsfunktion | undefined {
  return stab?.besetzung.find((z) => z.sachgebiet === sachgebiet);
}

/**
 * Besetzung als `StatusTag`-Darstellung, durchweg `neutral`: „nicht vergeben" ist im Fükw der
 * Normalfall, keine Alarmfarbe — das Wort trägt die Aussage.
 */
export function besetzungDarstellung(zeile: Stabsfunktion | undefined): StatusDarstellung {
  if (!zeile) return { rolle: 'neutral', label: 'nicht vergeben' };
  switch (zeile.besetzung_art) {
    case 'einsatzleitung':
      return { rolle: 'neutral', label: 'Einsatzleitung' };
    case 'personal': {
      const name = zeile.name ?? 'Person';
      return {
        rolle: 'neutral',
        label: zeile.personal_noch_disponiert ? name : `${name} · nicht mehr disponiert`,
      };
    }
    case 'extern':
      return { rolle: 'neutral', label: `${zeile.name ?? ''} (extern)` };
    case 'rueckwaertig':
      return { rolle: 'neutral', label: `${zeile.name ?? ''} (rückwärtig)` };
  }
}

/** Vorbelegung der Maske mit dem AKTUELLEN Zustand. */
export function besetzungFormWerte(zeile: Stabsfunktion | undefined): BesetzungFormWerte {
  if (!zeile) return { art: 'nicht_vergeben' };
  switch (zeile.besetzung_art) {
    case 'einsatzleitung':
      return { art: 'einsatzleitung' };
    case 'personal':
      return zeile.personal_id != null
        ? { art: 'personal', personal_id: zeile.personal_id }
        : { art: 'personal' };
    case 'extern':
    case 'rueckwaertig':
      return { art: zeile.besetzung_art, bezeichnung: zeile.name ?? undefined };
  }
}

export type BesetzungAktion =
  { typ: 'keine' } | { typ: 'entfernen' } | { typ: 'setzen'; daten: BesetzungBody };

/**
 * Was die Maske beim Übernehmen schickt — mit Wertgleichheits-Riegel.
 * Unverändert → `keine` (kein Request): ein PUT mit gleichem Wert schriebe `gesetzt_at` neu,
 * ein DELETE auf eine leere Zeile wäre ein Request für nichts. Geschickt wird NUR das Feld, das
 * die Art verlangt — überzählige Felder beantwortet das Backend mit 422, und der
 * Formularspeicher hält Werte eines vorher gewählten Zweigs.
 */
export function besetzungAktion(
  zeile: Stabsfunktion | undefined,
  werte: BesetzungFormWerte,
): BesetzungAktion {
  const vorher = besetzungFormWerte(zeile);
  const bezeichnung = werte.bezeichnung?.trim() || undefined;

  if (werte.art === 'nicht_vergeben') return zeile ? { typ: 'entfernen' } : { typ: 'keine' };

  if (werte.art === vorher.art) {
    if (werte.art === 'einsatzleitung') return { typ: 'keine' };
    if (werte.art === 'personal' && werte.personal_id === vorher.personal_id)
      return { typ: 'keine' };
    if (
      (werte.art === 'extern' || werte.art === 'rueckwaertig') &&
      bezeichnung === vorher.bezeichnung
    ) {
      return { typ: 'keine' };
    }
  }

  switch (werte.art) {
    case 'einsatzleitung':
      return { typ: 'setzen', daten: { besetzung_art: 'einsatzleitung' } };
    case 'personal':
      // Ohne gewählte Person gibt es nichts zu setzen (`required` hält den Zweig fern);
      // `BesetzungBody.personal_id` bleibt eine Zahl.
      return werte.personal_id != null
        ? { typ: 'setzen', daten: { besetzung_art: 'personal', personal_id: werte.personal_id } }
        : { typ: 'keine' };
    case 'extern':
    case 'rueckwaertig':
      return { typ: 'setzen', daten: { besetzung_art: werte.art, bezeichnung } };
  }
}

/**
 * Grund der fehlenden Schreibberechtigung als ganzer Satz; nennt beide gesperrten Wege
 * (Besetzung und Lagebesprechung).
 */
export function besetzungRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — Führungsorganisation und Lagebesprechungen sind nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können die Besetzung ändern und Lagebesprechungen abschließen.';
}
