/**
 * Der reine Kern des Standard-Rufnamens im ETB (LFH-894, Spec `etb-absender-empfaenger`): kein
 * Netz, kein React. Verdrahtung in `useStandardRufname.ts`, Anzeige in `Schnellerfassung.tsx`.
 *
 * Der Standard lebt NICHT im Entwurf (design.md D2): `metadaten` hält nur, was die Person
 * ausdrücklich gesetzt hat, und {@link wirksameMetadaten} setzt den Standard erst beim Anzeigen
 * und Absenden ein. So überlebt er das Leeren nach dem Absenden, alte Entwürfe tragen keinen
 * veralteten Wert, und ein geänderter Standard erreicht offene Entwürfe.
 */

import type { BenutzerEinstellungen } from '../api/types';
import type { MetadatenWerte } from './schnellerfassungModell';

/**
 * Der Schlüssel im Präferenz-Fach, byte-gleich zu `SCHLUESSEL_ETB_STANDARD_RUFNAME` in
 * `src/benutzer_einstellungen/mod.rs` (WHITELIST: ein Tippfehler ist ein 400).
 */
export const SCHLUESSEL_ETB_STANDARD_RUFNAME = 'etb_standard_rufname';

/** Standard-Absender und -Empfänger einer Person; beide Seiten nie leer. */
export interface StandardRufname {
  von: string;
  an: string;
}

/**
 * Liest den Standard aus dem Serverstand. Der Wert ist serverseitig OPAKER Text: ungültiges
 * JSON, eine falsche Form oder eine leere Seite gelten als „kein Standard“, nie als halber.
 */
export function leseStandardRufname(
  stand: BenutzerEinstellungen | undefined,
): StandardRufname | null {
  const roh = stand?.eintraege?.[SCHLUESSEL_ETB_STANDARD_RUFNAME];
  if (!roh) return null;
  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return null;
  }
  if (typeof wert !== 'object' || wert === null) return null;
  const { von, an } = wert as Record<string, unknown>;
  if (typeof von !== 'string' || typeof an !== 'string') return null;
  const v = von.trim();
  const a = an.trim();
  return v && a ? { von: v, an: a } : null;
}

/**
 * Der zu speichernde Wert. „Empfänger wie Absender“ wird nicht gespeichert, sondern als
 * `an = von` geschrieben (design.md D1); `null`, solange eine nötige Seite leer ist.
 */
export function standardRufnameWert(von: string, an: string, anWieVon: boolean): string | null {
  const v = von.trim();
  const a = anWieVon ? v : an.trim();
  if (!v || !a) return null;
  return JSON.stringify({ von: v, an: a });
}

/** Die Abfrage öffnet mit „Empfänger wie Absender“, solange beide Seiten gleich sind. */
export function anWieVon(standard: StandardRufname | null): boolean {
  return standard == null || standard.von === standard.an;
}

/**
 * Von/An, wie sie angezeigt und gesendet werden: ausdrücklich Gesetztes je Seite, sonst der
 * Standard. Ein leerer String zählt als nicht gesetzt.
 */
export function wirksameMetadaten(
  metadaten: MetadatenWerte,
  standard: StandardRufname | null,
): MetadatenWerte {
  return {
    ...metadaten,
    von: metadaten.von || standard?.von,
    an: metadaten.an || standard?.an,
  };
}

/** Kommt der angezeigte Wert dieser Seite aus dem Standard (kein eigener Wert gesetzt)? */
export function ausStandard(
  feld: 'von' | 'an',
  metadaten: MetadatenWerte,
  standard: StandardRufname | null,
): boolean {
  return !metadaten[feld] && !!standard?.[feld];
}

/** Die erste Seite, die beim Absenden fehlt, sonst `null` (Pflicht, design.md D7). */
export function fehlendeSeite(wirksam: MetadatenWerte): 'von' | 'an' | null {
  if (!wirksam.von?.trim()) return 'von';
  if (!wirksam.an?.trim()) return 'an';
  return null;
}
