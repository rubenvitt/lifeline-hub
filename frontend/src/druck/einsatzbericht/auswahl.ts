/**
 * Blöcke des Einsatzberichts und ihre Auswahl (LFH-902,
 * `openspec/changes/lfh-902-einsatzbericht-bloecke-auswaehlen/design.md` D1, D2, D4).
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
  | 'etb'
  | 'einheiten-zeiten'
  | 'personal-kopf';

export interface BlockDef {
  schluessel: BlockSchluessel;
  titel: string;
  /** Teil des Standardumfangs (der Bericht aus LFH-726); sonst eine optionale Anlage. */
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
  { schluessel: 'etb', titel: 'ETB-Auszug', standard: true },
  { schluessel: 'einheiten-zeiten', titel: 'Anlage Einheiten mit Einsatzzeiten', standard: false },
  { schluessel: 'personal-kopf', titel: 'Anlage Personal je Kopf', standard: false },
];

export const STANDARDUMFANG: readonly BlockSchluessel[] = BLOECKE.filter((b) => b.standard).map(
  (b) => b.schluessel,
);

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

export function istStandardumfang(auswahl: readonly BlockSchluessel[]): boolean {
  return (
    auswahl.length === STANDARDUMFANG.length && STANDARDUMFANG.every((b) => auswahl.includes(b))
  );
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
 * Auswahl ist und welche — wie „vollständiges Tagebuch“ im ETB-Druck (`etb/druckAuswahl.ts`).
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
