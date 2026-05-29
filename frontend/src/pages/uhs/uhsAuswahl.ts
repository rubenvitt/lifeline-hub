import type { Uhs } from '../../api/types';

/**
 * Wählt die UHS für den Default-Einstieg.
 * Priorität: (1) zuletzt ausgewählte (falls noch in der Liste),
 * (2) älteste aktive, (3) sonst zuletzt angelegte.
 * Anlage-Reihenfolge = id (monoton steigend), unabhängig von erfasst_at.
 * Liefert null, wenn keine UHS existiert.
 */
export function waehleDefaultUhs(liste: Uhs[], letzteId: number | null): number | null {
  if (liste.length === 0) return null;

  if (letzteId != null && liste.some((u) => u.id === letzteId)) return letzteId;

  const aktive = liste.filter((u) => u.status === 'aktiv');
  if (aktive.length > 0) return Math.min(...aktive.map((u) => u.id));

  return Math.max(...liste.map((u) => u.id));
}

const schluessel = (einsatzId: number) => `uhs:letzteAuswahl:${einsatzId}`;

/** Merkt die zuletzt im Detail geöffnete UHS pro Einsatz (überlebt Reload). */
export function merkeLetzteUhs(einsatzId: number, uhsId: number): void {
  try {
    localStorage.setItem(schluessel(einsatzId), String(uhsId));
  } catch {
    /* localStorage nicht verfügbar — ohne Persistenz weiterarbeiten */
  }
}

/** Liest die zuletzt ausgewählte UHS eines Einsatzes, oder null. */
export function liesLetzteUhs(einsatzId: number): number | null {
  try {
    const wert = localStorage.getItem(schluessel(einsatzId));
    return wert ? Number(wert) : null;
  } catch {
    return null;
  }
}
