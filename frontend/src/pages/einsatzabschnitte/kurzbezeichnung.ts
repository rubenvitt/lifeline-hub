import type { Einsatzabschnitt } from '../../api/types';

/** Vergleichsform der Kurzbezeichnung wie SQLite `NOCASE`: getrimmt, nur A–Z gefaltet. */
export const nocase = (s: string) => s.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Der Abschnitt, der die Kurzbezeichnung `wert` schon trägt — `undefined`, wenn sie frei, leer oder
 * die eigene (`eigeneId`) ist. Spiegelt den Index `einsatzabschnitt_kurzbezeichnung_eindeutig`
 * (NOCASE), damit Detailzeile und Anlegen-Dialog am Feld ablehnen statt erst am Server (LFH-1078,
 * LFH-1208). Der Server bleibt die Wahrheit.
 */
export function findKurzbezeichnungKonflikt(
  abschnitte: readonly Einsatzabschnitt[],
  wert: string,
  eigeneId: number | undefined,
): Einsatzabschnitt | undefined {
  const kurz = nocase(wert);
  if (kurz === '') return undefined;
  return abschnitte.find(
    (a) => a.id !== eigeneId && a.kurzbezeichnung != null && nocase(a.kurzbezeichnung) === kurz,
  );
}

/** Wortlaut der Ablehnung — eine Quelle für Zeile und Dialog. */
export const kurzbezeichnungVergeben = (belegt: Einsatzabschnitt) =>
  `Schon vergeben (${belegt.name})`;
