/**
 * Blöcke des Einsatzberichts und ihre Auswahl (LFH-902, D1, D2, D4 in
 * `openspec/changes/archive/2026-10-05-lfh-902-einsatzbericht-bloecke-auswaehlen/design.md`).
 *
 * Ohne Abhängigkeiten, damit `routing/deeplinks.ts` die Auswahl lesen kann, ohne die Quellen
 * samt Modul-Registry zu laden.
 *
 * Die Adresse trägt eine Positivliste `?bloecke=a,b`: unbekannte und doppelte Schlüssel fallen
 * weg, geordnet wird nach {@link BLOECKE}, nicht nach der Adresse. Bleibt nichts übrig, gilt der
 * Standardumfang — ein Ausdruck ohne einen einzigen Block gibt es nicht.
 */

export type BlockSchluessel =
  | 'stammdaten'
  | 'zeiten'
  | 'fuehrung'
  | 'kraefte'
  | 'lage'
  | 'bilanz'
  | 'hilfeleistungen'
  | 'etb'
  | 'einheiten-zeiten'
  | 'personal-kopf'
  | 'materialverbrauch';

export interface BlockDef {
  schluessel: BlockSchluessel;
  titel: string;
  /** Teil des Standardumfangs (LFH-726, seit LLH-1575 mit Hilfeleistungen); sonst eine Anlage. */
  standard: boolean;
}

/**
 * Die Blöcke in Druckreihenfolge (Spec `einsatzbericht`, „Blöcke in fester Reihenfolge“). Die
 * Anlagen stehen am Ende: erst die Zusammenfassung, dann die langen Listen.
 */
export const BLOECKE: readonly BlockDef[] = [
  { schluessel: 'stammdaten', titel: 'Stammdaten', standard: true },
  { schluessel: 'zeiten', titel: 'Zeiten', standard: true },
  { schluessel: 'fuehrung', titel: 'Führung', standard: true },
  { schluessel: 'kraefte', titel: 'Kräfte', standard: true },
  { schluessel: 'lage', titel: 'Lage', standard: true },
  { schluessel: 'bilanz', titel: 'Bilanz', standard: true },
  // LLH-1575 (design.md D1): Zählungen eines Sanitätsdienstes, im Standardumfang.
  { schluessel: 'hilfeleistungen', titel: 'Hilfeleistungen', standard: true },
  { schluessel: 'etb', titel: 'ETB-Auszug', standard: true },
  { schluessel: 'einheiten-zeiten', titel: 'Anlage Einheiten mit Einsatzzeiten', standard: false },
  { schluessel: 'personal-kopf', titel: 'Anlage Personal je Kopf', standard: false },
  { schluessel: 'materialverbrauch', titel: 'Anlage Materialverbrauch', standard: false },
];

export const STANDARDUMFANG: readonly BlockSchluessel[] = BLOECKE.filter((b) => b.standard).map(
  (b) => b.schluessel,
);

/**
 * Kurzbericht für den Auftraggeber (LLH-1575, design.md D5): eine Voreinstellung der Auswahl, kein
 * eigenes Dokument. Ohne Führung, Lage, Bilanz, ETB-Auszug und Anlagen; die Helferstunden stehen
 * im Block Kräfte.
 */
export const KURZBERICHT: readonly BlockSchluessel[] = [
  'stammdaten',
  'zeiten',
  'kraefte',
  'hilfeleistungen',
];

/** Name des Adressparameters. */
export const AUSWAHL_PARAM = 'bloecke';

/** Eine Menge von Blöcken in Druckreihenfolge, ohne Unbekanntes und Doppeltes. */
export function ordneAuswahl(schluessel: Iterable<string>): BlockSchluessel[] {
  const gewaehlt = new Set(schluessel);
  return BLOECKE.filter((b) => gewaehlt.has(b.schluessel)).map((b) => b.schluessel);
}

/** Umkehr von `einsatzberichtPfad`: die Auswahl aus der Adresse. */
export function parseBerichtAuswahl(params: URLSearchParams): BlockSchluessel[] {
  const roh = params
    .getAll(AUSWAHL_PARAM)
    .flatMap((w) => w.split(','))
    .map((w) => w.trim());
  const auswahl = ordneAuswahl(roh);
  return auswahl.length > 0 ? auswahl : [...STANDARDUMFANG];
}

/** Genau diese Menge, ohne Rücksicht auf Reihenfolge und Doppeltes. */
function gleicheMenge(
  auswahl: readonly BlockSchluessel[],
  menge: readonly BlockSchluessel[],
): boolean {
  const a = new Set(auswahl);
  return a.size === menge.length && menge.every((b) => a.has(b));
}

export function istStandardumfang(auswahl: readonly BlockSchluessel[]): boolean {
  return gleicheMenge(auswahl, STANDARDUMFANG);
}

export function istKurzbericht(auswahl: readonly BlockSchluessel[]): boolean {
  return gleicheMenge(auswahl, KURZBERICHT);
}

/** Der Wert für `?bloecke=`; `undefined` beim Standardumfang, damit dessen Adresse kurz bleibt. */
export function auswahlParam(auswahl: readonly BlockSchluessel[]): string | undefined {
  if (istStandardumfang(auswahl)) return undefined;
  return ordneAuswahl(auswahl).join(',');
}

/** Ein stabiler Schlüssel der Auswahl, etwa für den Schnappschuss-Key. */
export function auswahlSchluessel(auswahl: readonly BlockSchluessel[]): string {
  return ordneAuswahl(auswahl).join(',');
}

/**
 * Die Zeilen des Druckkopfs (Spec „Druckkopf nennt den Umfang“): ein Ausdruck sagt, OB er eine
 * Auswahl ist und welche — wie „vollständiges Tagebuch“ im ETB-Druck (`etb/druckAuswahl.ts`). Der
 * Kurzbericht heißt bei genau seiner Menge so (LLH-1575, design.md D5).
 * Die Personal-Anlage trägt Namen von Einsatzkräften; das steht ausdrücklich im Kopf.
 */
export function umfangZeilen(
  auswahl: readonly BlockSchluessel[],
): { etikett: string; wert: string }[] {
  const geordnet = ordneAuswahl(auswahl);
  const zeilen = [
    {
      etikett: 'Umfang',
      wert: istStandardumfang(geordnet)
        ? 'Standardumfang'
        : istKurzbericht(geordnet)
          ? 'Kurzbericht für den Auftraggeber'
          : `Auswahl: ${BLOECKE.filter((b) => geordnet.includes(b.schluessel))
              .map((b) => b.titel)
              .join(', ')}`,
    },
  ];
  if (geordnet.includes('personal-kopf')) {
    zeilen.push({ etikett: 'Personenbezug', wert: 'enthält Namen von Einsatzkräften' });
  }
  return zeilen;
}
