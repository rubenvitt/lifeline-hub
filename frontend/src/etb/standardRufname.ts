/**
 * Der reine Kern des Standard-Rufnamens im ETB (LFH-894, Spec `etb-absender-empfaenger`): kein
 * Netz, kein React. Verdrahtung in `useStandardRufname.ts`, Anzeige in `Schnellerfassung.tsx`.
 *
 * Der Standard lebt NICHT im Entwurf (design.md D2): `metadaten` hält nur, was die Person
 * ausdrücklich gesetzt hat, und {@link wirksameMetadaten} setzt den Standard erst beim Anzeigen
 * und Absenden ein. So überlebt er das Leeren nach dem Absenden, alte Entwürfe tragen keinen
 * veralteten Wert, und ein geänderter Standard erreicht offene Entwürfe.
 */

import type { BenutzerEinstellungen, EtbTyp } from '../api/types';
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
 * Welche Seite die eigene Stelle als Vorgabe trägt, je Typ (Spec `etb-absender-empfaenger`,
 * „Vorbelegung neuer Einträge“; Change `kwc2yszv-etb-neuentwurf`, design.md D3): eine Meldung
 * kommt von außen an die eigene Stelle, eine Anordnung geht von ihr aus, Entscheidung und Lage
 * sind eigene Vermerke. Die leere Seite ist Pflicht und wird von Hand gesetzt.
 */
const VORGABE_JE_TYP: Record<EtbTyp, { von: boolean; an: boolean }> = {
  meldung: { von: false, an: true },
  anordnung: { von: true, an: false },
  entscheidung: { von: true, an: true },
  lage: { von: true, an: true },
  // Systemeinträge schreibt der Server. Eine Berichtigung trägt Von und An des berichtigten
  // Eintrags ausdrücklich (`Schnellerfassung`, Startwerte); fehlt dort eine Seite (Bestand vor
  // LFH-894), gilt die eigene Stelle.
  system: { von: false, an: false },
  berichtigung: { von: true, an: true },
};

/**
 * Von/An, wie sie angezeigt und gesendet werden: ausdrücklich Gesetztes je Seite, sonst die
 * Vorgabe des Typs aus dem Standard. Ein leerer String zählt als nicht gesetzt. Ein Typwechsel
 * ändert nur die Vorgabe, weil der Entwurf nur Ausdrückliches hält.
 */
export function wirksameMetadaten(
  metadaten: MetadatenWerte,
  standard: StandardRufname | null,
  typ: EtbTyp,
): MetadatenWerte {
  const vorgabe = VORGABE_JE_TYP[typ];
  return {
    ...metadaten,
    von: metadaten.von || (vorgabe.von ? standard?.von : undefined),
    an: metadaten.an || (vorgabe.an ? standard?.an : undefined),
  };
}

/** Kommt der angezeigte Wert dieser Seite aus der Vorgabe (kein eigener Wert gesetzt)? */
export function ausStandard(
  feld: 'von' | 'an',
  metadaten: MetadatenWerte,
  standard: StandardRufname | null,
  typ: EtbTyp,
): boolean {
  return !metadaten[feld] && VORGABE_JE_TYP[typ][feld] && !!standard?.[feld];
}

/** Ist dieser Wert die eigene Stelle, also eine Seite des Standards? */
function istEigeneStelle(wert: string | undefined, standard: StandardRufname): boolean {
  const w = wert?.trim();
  return !!w && (w === standard.von || w === standard.an);
}

/**
 * Vorgabe von „Auch in den Meldungseingang“ (Change `kwc2yszv-etb-neuentwurf`, design.md D4): an,
 * außer Von und An sind beide die eigene Stelle — dann ist der Eintrag ein eigener Vermerk und
 * gehört nicht in den Eingang. Ohne Standard gibt es keine eigene Stelle: an.
 */
export function meldungseingangVorgabe(
  wirksam: MetadatenWerte,
  standard: StandardRufname | null,
): boolean {
  if (!standard) return true;
  return !(istEigeneStelle(wirksam.von, standard) && istEigeneStelle(wirksam.an, standard));
}

/**
 * Steht der Schalter an? `nurProtokollieren` ist das Entwurfsfeld `nur_protokollieren`, dreiwertig
 * gelesen: `true` = von Hand aus, `false` = von Hand an, fehlt = Vorgabe.
 */
export function auchInMeldungseingang(
  nurProtokollieren: boolean | undefined,
  wirksam: MetadatenWerte,
  standard: StandardRufname | null,
): boolean {
  if (nurProtokollieren != null) return !nurProtokollieren;
  return meldungseingangVorgabe(wirksam, standard);
}

/** Die erste Seite, die beim Absenden fehlt, sonst `null` (Pflicht, design.md D7). */
export function fehlendeSeite(wirksam: MetadatenWerte): 'von' | 'an' | null {
  if (!wirksam.von?.trim()) return 'von';
  if (!wirksam.an?.trim()) return 'an';
  return null;
}
