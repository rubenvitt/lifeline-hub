/**
 * Auftragsschema nach FwDV 100 (LLH-1091, Spec `auftragsschema`): der Einzelauftrag in der
 * Reihenfolge Einheit – Auftrag – Mittel – Ziel – Weg, ergänzt um die Zeit. Einheit (Empfänger)
 * und Auftrag stehen sichtbar im Formular; dieses Modul hält die Folge der Felder dahinter, die
 * Formular (`AuftragFormular`), Lesefassung (`AuftragKarte`) und Auftragsblatt (`druckFelder`,
 * LLH-1171) teilen, damit sie nur einmal steht.
 * Herleitung: `openspec/changes/archive/2026-10-12-o5gsxa7g-auftragsschema-fwdv100/design.md`
 * (D2, D3, D5).
 */

import type { AdressatKategorie, Auftrag, AuftragSchemafeld } from '../api/types';
import { mitBesetzung } from '../fuehrung/funktionsOptionenKern';
import { PRIO_META } from '../kommunikation/phase';

/** Die Freitextfelder des Befehlsschemas am Auftrag (Wire-Namen, auch die der Berichtigung). */
export type SchemaFeld = AuftragSchemafeld;

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

/** Nur die gesetzten Angaben; ein Wert aus Leerzeichen fällt weg wie ein leerer. */
export function dropEmpty(
  angaben: { etikett: string; wert: string | null | undefined }[],
): { etikett: string; wert: string }[] {
  return angaben.flatMap(({ etikett, wert }) =>
    typeof wert === 'string' && wert.trim() !== '' ? [{ etikett, wert }] : [],
  );
}

/** Etiketten der externen Stellen; das Formular bietet sie in dieser Folge an. */
export const EXTERN_KATEGORIE_LABEL: Record<AdressatKategorie, string> = {
  leitstelle: 'Leitstelle',
  nachbar_ea: 'Nachbar-Einsatzabschnitt',
  uebergeordnet: 'Übergeordnete Führung',
  andere_bos: 'Andere BOS',
};

/** „Intern“ bzw. „Extern“ samt den externen Stellen unter den Empfängern. */
function richtungText(a: Auftrag): string {
  if (a.richtung !== 'extern') return 'Intern';
  const stellen = a.empfaenger
    .filter((e) => e.empfaenger_typ === 'extern')
    .map((e) => {
      const kategorie = e.extern_kategorie ? EXTERN_KATEGORIE_LABEL[e.extern_kategorie] : '';
      const name = e.extern_bezeichnung ?? e.snap_anzeige;
      return kategorie ? `${kategorie}: ${name}` : name;
    });
  return ['Extern', stellen.join(', ')].filter(Boolean).join(' · ');
}

/**
 * Die Angaben des Auftragsblatts (LLH-1171, Spec `druck-dokumente`, „Das Auftragsblatt liest in der
 * Reihenfolge der FwDV 100“): Empfänger, Auftrag, Priorität, Frist, dann die Lesefolge der Karte
 * ({@link READ_ORDER}), dann Richtung und Erteilzeit. Leere Angaben fallen weg; Zeiten über
 * `formatZeit` der Anzeigezone. Herleitung:
 * `openspec/changes/ianaw5k1-auftrag-drucken/design.md` (D4).
 */
export function druckFelder(
  a: Auftrag,
  formatZeit: (wire?: string | null) => string,
): { etikett: string; wert: string }[] {
  const felder: { etikett: string; wert: string | null | undefined }[] = [
    {
      etikett: 'Empfänger',
      wert: a.empfaenger.map((e) => mitBesetzung(e.snap_anzeige, e.aktuelle_besetzung)).join(', '),
    },
    { etikett: 'Auftrag', wert: a.auftrag_text },
    { etikett: 'Priorität', wert: PRIO_META[a.prioritaet]?.label ?? a.prioritaet },
    { etikett: 'Frist', wert: a.frist_at ? formatZeit(a.frist_at) : null },
    ...READ_ORDER.map((key) => ({ etikett: READ_LABEL[key], wert: a[key] })),
    { etikett: 'Richtung', wert: richtungText(a) },
    { etikett: 'Erteilt am', wert: formatZeit(a.erteilt_at) },
  ];
  return dropEmpty(felder);
}
