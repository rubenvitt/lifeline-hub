/**
 * Auftragsschema nach FwDV 100 (LLH-1091, Spec `auftragsschema`): der Einzelauftrag in der
 * Reihenfolge Einheit – Auftrag – Mittel – Ziel – Weg, ergänzt um die Zeit. Einheit (Empfänger)
 * und Auftrag stehen sichtbar im Formular; dieses Modul hält die Folge der Felder dahinter, die
 * Formular (`AuftragFormular`) und Lesefassung (`AuftragKarte`) teilen, damit sie nur einmal steht.
 * Herleitung: `openspec/changes/archive/2026-10-12-o5gsxa7g-auftragsschema-fwdv100/design.md`
 * (D2, D3, D5).
 */

/** Die Freitextfelder des Befehlsschemas am Auftrag (Wire-Namen). */
export type SchemaFeld =
  'mittel' | 'ort' | 'weg' | 'zeit' | 'lage' | 'absicht' | 'verbindung' | 'sicherheit';

/** Schlüssel der beiden Klappteile des Formulars. */
export const KLAPPTEIL = { ausfuehrung: 'ausfuehrung', weitere: 'weitere' } as const;
export type Klappteil = (typeof KLAPPTEIL)[keyof typeof KLAPPTEIL];

/** Köpfe der Klappteile: sie nennen, was darin liegt (design.md D2). */
export const KLAPPTEIL_HEADER: Record<Klappteil, string> = {
  ausfuehrung: 'Ausführung: Mittel, Ziel, Weg, Zeit',
  weitere: 'Weitere Angaben',
};

/** Erster Klappteil: Mittel, Ziel, Weg, Zeit. `ort` ist das Ziel der Ausführung (D3). */
export const AUSFUEHRUNG_FIELDS = ['mittel', 'ort', 'weg', 'zeit'] as const satisfies SchemaFeld[];

/**
 * Zweiter Klappteil: die übrigen Schemafelder, dazu Richtung und Erteilzeit; die Extern-Felder
 * gehen mit der Richtung, die sie einblendet (Formularnamen, nicht nur Schemafelder).
 */
export const WEITERE_FIELDS = [
  'lage',
  'absicht',
  'verbindung',
  'sicherheit',
  'richtung',
  'erteiltAm',
  'externKategorie',
  'externBezeichnung',
] as const;

/** Etiketten im Formular, mit Fragewort wo es hilft („Womit“, „Wann“). */
export const FORM_LABEL: Record<SchemaFeld, string> = {
  mittel: 'Mittel / Womit',
  ort: 'Ziel / Ort',
  weg: 'Weg',
  zeit: 'Zeit / Wann',
  lage: 'Lage',
  absicht: 'Absicht',
  verbindung: 'Verbindung / Meldewege',
  sicherheit: 'Sicherheit / Besonderes',
};

/** Name des Feldes in einer Längenmeldung, gleich der Meldung des Servers (`auftrag/eingabe.rs`). */
export const VALIDATION_NAME: Record<SchemaFeld, string> = {
  mittel: 'Mittel',
  ort: 'Ziel/Ort',
  weg: 'Weg',
  zeit: 'Zeit',
  lage: 'Lage',
  absicht: 'Absicht',
  verbindung: 'Verbindung',
  sicherheit: 'Sicherheit',
};

/** Lesefolge der Karte = Formularfolge der Schemafelder (Spec: „liest in derselben Reihenfolge“). */
export const READ_ORDER: SchemaFeld[] = [
  ...AUSFUEHRUNG_FIELDS,
  ...WEITERE_FIELDS.filter(
    (f): f is Extract<(typeof WEITERE_FIELDS)[number], SchemaFeld> => f in FORM_LABEL,
  ),
];

/** Etiketten der Lesefassung: ohne die Fragewörter des Formulars. */
export const READ_LABEL: Record<SchemaFeld, string> = {
  ...FORM_LABEL,
  mittel: 'Mittel',
  zeit: 'Zeit',
};

/** Der Klappteil, hinter dem ein Formularfeld liegt; sichtbare Felder liegen hinter keinem. */
export function klappteilFuer(feld: string): Klappteil | null {
  if ((AUSFUEHRUNG_FIELDS as readonly string[]).includes(feld)) return KLAPPTEIL.ausfuehrung;
  if ((WEITERE_FIELDS as readonly string[]).includes(feld)) return KLAPPTEIL.weitere;
  return null;
}
