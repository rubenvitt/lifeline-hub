/**
 * Sitzungsweite Wiederholwerte konkreter Erfassungsmasken.
 *
 * Der Schlüssel trennt Einsatz, Maske und Feld. Es werden ausschließlich rohe
 * Strings gespeichert: kein JSON, keine Datensätze und keine fachfremden Felder.
 * Die Werte gehören dem Benutzer, an den sie gebunden sind ({@link erfassungsSitzungBinden}).
 * Jeder Storage-Zugriff ist optional, weil Browser die API z. B. im Privatmodus
 * bereitstellen und trotzdem mit einem SecurityError ablehnen können.
 */
const PRAEFIX = 'lfh:erfassung:';
/** Wem die Werte gehören. Liegt unter dem Präfix, damit `erfassungsSitzungRaeumen` es mitnimmt;
 *  kollidiert nicht mit den Wertschlüsseln, die nach dem Präfix mit der Einsatz-id beginnen. */
const BESITZER = `${PRAEFIX}besitzer`;

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

/** Benutzerwechsel ohne Abmelden in diesem Tab (LFH-785): Der Konfliktdialog aus LFH-387 lädt die
 *  Seite als B neu, der sessionStorage überlebt das. Gehören die Werte nicht `benutzerId` — oder
 *  niemandem, weil sie vor der Bindung entstanden —, gehen sie, statt B vorbelegt zu werden.
 *  Derselbe Benutzer behält sie. Ohne Benutzer (`null`) räumt es nichts, das tun Abmelden und
 *  Sitzungsende. Aufgerufen synchron mit jedem Benutzerwechsel im `AuthProvider`. */
export function erfassungsSitzungBinden(benutzerId: number | null): void {
  if (benutzerId == null) return;
  try {
    const speicher = globalThis.sessionStorage;
    if (!speicher) return;
    const eigen = String(benutzerId);
    if (speicher.getItem(BESITZER) === eigen) return;
    erfassungsSitzungRaeumen();
    speicher.setItem(BESITZER, eigen);
  } catch {
    /* sessionStorage nicht verfügbar — dann liegt dort auch nichts */
  }
}
