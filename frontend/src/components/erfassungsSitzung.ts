/**
 * Sitzungsweite Wiederholwerte konkreter Erfassungsmasken.
 *
 * Der Schlüssel trennt Einsatz, Maske und Feld. Es werden ausschließlich rohe
 * Strings gespeichert: kein JSON, keine Datensätze und keine fachfremden Felder.
 * Jeder Storage-Zugriff ist optional, weil Browser die API z. B. im Privatmodus
 * bereitstellen und trotzdem mit einem SecurityError ablehnen können.
 */
function schluessel(einsatzId: number, maske: string, feld: string): string {
  return `lfh:erfassung:${einsatzId}:${maske}:${feld}`;
}

export function liesErfassungsSitzungswert(
  einsatzId: number,
  maske: string,
  feld: string,
): string | undefined {
  try {
    return globalThis.sessionStorage?.getItem(schluessel(einsatzId, maske, feld)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function schreibeErfassungsSitzungswert(
  einsatzId: number,
  maske: string,
  feld: string,
  wert: string,
): void {
  if (typeof wert !== 'string') return;
  try {
    globalThis.sessionStorage?.setItem(schluessel(einsatzId, maske, feld), wert);
  } catch {
    /* sessionStorage nicht verfügbar — ohne Sitzungswert weiterarbeiten */
  }
}
