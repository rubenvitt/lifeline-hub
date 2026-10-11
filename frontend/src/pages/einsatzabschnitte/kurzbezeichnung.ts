import type { Einsatzabschnitt } from '../../api/types';

/** Vergleichsform der Kurzbezeichnung wie SQLite `NOCASE`: getrimmt, nur A–Z gefaltet. */
export const nocase = (s: string) => s.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Der Abschnitt, der die Kurzbezeichnung `value` schon trägt — `undefined`, wenn sie frei, leer oder
 * die eigene (`ownId`) ist. Spiegelt den Index `einsatzabschnitt_kurzbezeichnung_eindeutig`
 * (NOCASE), damit Detailzeile und Anlegen-Dialog am Feld ablehnen statt erst am Server (LFH-1078,
 * LFH-1208). Der Server bleibt die Wahrheit.
 */
export function findKurzbezeichnungConflict(
  abschnitte: readonly Einsatzabschnitt[],
  value: string,
  ownId: number | undefined,
): Einsatzabschnitt | undefined {
  const normalized = nocase(value);
  if (normalized === '') return undefined;
  return abschnitte.find(
    (a) => a.id !== ownId && a.kurzbezeichnung != null && nocase(a.kurzbezeichnung) === normalized,
  );
}

/** Wortlaut der Ablehnung — eine Quelle für Zeile und Dialog. */
export const kurzbezeichnungVergeben = (conflict: Einsatzabschnitt) =>
  `Schon vergeben (${conflict.name})`;
