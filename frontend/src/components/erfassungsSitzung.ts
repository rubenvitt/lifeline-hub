/**
 * Sitzungsweite Wiederholwerte konkreter Erfassungsmasken.
 *
 * Der Schlüssel trennt Einsatz, Maske und Feld. Es werden ausschließlich rohe
 * Strings gespeichert: kein JSON, keine Datensätze und keine fachfremden Felder.
 * Jeder Storage-Zugriff ist optional, weil Browser die API z. B. im Privatmodus
 * bereitstellen und trotzdem mit einem SecurityError ablehnen können.
 */
const PRAEFIX = 'lfh:erfassung:';

function schluessel(einsatzId: number, maske: string, feld: string): string {
  return `${PRAEFIX}${einsatzId}:${maske}:${feld}`;
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

/** Abmelden und Sitzungsende (LFH-767): Ein zweiter Benutzer im selben Tab bekäme sonst den
 *  Antreff- bzw. Schadensort des ersten vorbelegt. Fremde Schlüssel bleiben. */
export function erfassungsSitzungRaeumen(): void {
  try {
    const speicher = globalThis.sessionStorage;
    if (!speicher) return;
    const schluesselListe: string[] = [];
    for (let i = 0; i < speicher.length; i++) {
      const k = speicher.key(i);
      if (k?.startsWith(PRAEFIX)) schluesselListe.push(k);
    }
    for (const k of schluesselListe) speicher.removeItem(k);
  } catch {
    /* sessionStorage nicht verfügbar — dann liegt dort auch nichts */
  }
}
